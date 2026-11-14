import 'server-only';

import { randomUUID } from 'node:crypto';

import type { NextRequest } from 'next/server';

import { recordAudit } from '@/lib/server/audit/audit-service';
import { FirestoreCostMeter } from '@/lib/server/firestore/cost-meter';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { listRelayApplications } from '@/lib/server/relay/relay-client';
import {
  collectTenantStats,
  getTenantStats,
  saveTenantStats,
} from '@/lib/server/statistics/tenant-stats';
import { syncTenantControlFromStats } from '@/lib/server/statistics/tenant-control';
import { recordStatisticsBatchRun } from '@/lib/server/statistics/operation-metrics';
import { parseJsonBody, refreshAllTenantStatsRequestSchema } from '@/lib/server/validation/schemas';
import type {
  RelayTenantSummary,
  StatisticsBatchTenantResult,
} from '@/lib/shared/platform-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A cached result younger than this is skipped unless `force` is true. */
const FRESH_WINDOW_MS = 15 * 60 * 1000;
/** Stop starting new tenants after this long so the request stays short. */
const TIME_BUDGET_MS = 5_000;
const DEFAULT_MAX_TENANTS = 10;

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function sortTenants(
  left: RelayTenantSummary,
  right: RelayTenantSummary,
): number {
  return (
    left.projectId.localeCompare(right.projectId) ||
    left.tenantId.localeCompare(right.tenantId)
  );
}

/**
 * Refreshes tenant statistics in small time-boxed batches.
 *
 * The browser calls this route repeatedly with the returned `nextOffset` until
 * `done` is true. Each call reports the Firestore reads and writes it caused,
 * so the UI can show the real cost instead of an estimate. Only cached
 * statistics and control records are written; tenant projects stay read-only.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'POST /api/platform/statistics/refresh-all',
      auth: 'session',
      permission: 'reporting:refresh',
      mutation: true,
      rateLimit: { limit: 120, windowMs: 60_000 },
    },
    async (context) => {
      const body = await parseJsonBody(request, refreshAllTenantStatsRequestSchema);
      const startedAt = Date.now();
      const requestMeter = new FirestoreCostMeter();

      const applications = await listRelayApplications(requestMeter);
      const tenants = applications
        .filter((tenant) => !body.projectId || tenant.projectId === body.projectId)
        .sort(sortTenants);

      const offset = Math.min(body.offset ?? 0, tenants.length);
      const maxTenants = body.maxTenants ?? DEFAULT_MAX_TENANTS;
      const deadline = Date.now() + TIME_BUDGET_MS;

      const results: StatisticsBatchTenantResult[] = [];
      let refreshedTenants = 0;
      let skippedTenants = 0;
      let failedTenants = 0;
      let examinedTenants = 0;

      while (offset + examinedTenants < tenants.length && examinedTenants < maxTenants) {
        if (examinedTenants > 0 && Date.now() >= deadline) break;

        const tenant = tenants[offset + examinedTenants];
        if (!tenant) break;
        examinedTenants += 1;

        const tenantStartedAt = Date.now();
        const tenantMeter = new FirestoreCostMeter();

        try {
          const cached = await getTenantStats(
            tenant.projectId,
            tenant.tenantId,
            tenantMeter,
          );
          const isFresh =
            cached !== null &&
            cached.status === 'ok' &&
            Date.now() - Date.parse(cached.computedAt) < FRESH_WINDOW_MS;

          if (isFresh && body.force !== true) {
            skippedTenants += 1;
            results.push({
              projectId: tenant.projectId,
              tenantId: tenant.tenantId,
              applicationId: tenant.applicationId,
              outcome: 'skipped',
              durationMs: Date.now() - tenantStartedAt,
              errorCount: 0,
              errorMessage: null,
              cost: tenantMeter.toSummary(),
            });
          } else {
            const collectionMeter = new FirestoreCostMeter();
            const stats = await collectTenantStats(tenant, collectionMeter);
            stats.collectionCost = collectionMeter.toSummary();
            tenantMeter.merge(collectionMeter);

            await saveTenantStats(stats, tenantMeter);
            await syncTenantControlFromStats(stats, tenantMeter).catch(() => null);

            const outcome = stats.status === 'failed' ? 'failed' : 'refreshed';
            if (outcome === 'failed') failedTenants += 1;
            else refreshedTenants += 1;

            results.push({
              projectId: tenant.projectId,
              tenantId: tenant.tenantId,
              applicationId: tenant.applicationId,
              outcome,
              durationMs: Date.now() - tenantStartedAt,
              errorCount: stats.errors.length,
              errorMessage: stats.errors[0] ?? null,
              cost: tenantMeter.toSummary(),
            });
          }
        } catch (error) {
          failedTenants += 1;
          results.push({
            projectId: tenant.projectId,
            tenantId: tenant.tenantId,
            applicationId: tenant.applicationId,
            outcome: 'failed',
            durationMs: Date.now() - tenantStartedAt,
            errorCount: 1,
            errorMessage: describeError(error),
            cost: tenantMeter.toSummary(),
          });
        }

        requestMeter.merge(tenantMeter);
      }

      const nextOffset = offset + examinedTenants;
      const done = nextOffset >= tenants.length;

      // The metrics record and the audit entry are writes too. Count them
      // before publishing the cost so the reported number includes the whole
      // request.
      if (examinedTenants > 0) {
        requestMeter.recordWrites(2);
        const cost = requestMeter.toSummary();

        await recordStatisticsBatchRun({
          runId: randomUUID(),
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
          totalTenants: tenants.length,
          examinedTenants,
          refreshedTenants,
          skippedTenants,
          failedTenants,
          reads: cost.reads,
          writes: cost.writes,
          durationMs: Date.now() - startedAt,
        }).catch(() => null);

        if (context.session) {
          await recordAudit({
            actor: {
              uid: context.session.uid,
              email: context.session.email,
              role: context.session.role,
            },
            action: 'statistics.batch_refreshed',
            targetType: 'platform',
            targetId: body.projectId ?? 'all-projects',
            tenantId: null,
            result: 'success',
            metadata: {
              projectId: body.projectId ?? null,
              totalTenants: tenants.length,
              examinedTenants,
              refreshedTenants,
              skippedTenants,
              failedTenants,
              reads: cost.reads,
              writes: cost.writes,
              durationMs: Date.now() - startedAt,
              nextOffset,
              done,
            },
            context: context.auditContext,
          });
        }

        return jsonOk(
          {
            totalTenants: tenants.length,
            examinedTenants,
            refreshedTenants,
            skippedTenants,
            failedTenants,
            nextOffset,
            done,
            cost,
            results,
          },
          { requestId: context.requestId },
        );
      }

      return jsonOk(
        {
          totalTenants: tenants.length,
          examinedTenants: 0,
          refreshedTenants: 0,
          skippedTenants: 0,
          failedTenants: 0,
          nextOffset,
          done: true,
          cost: requestMeter.toSummary(),
          results: [],
        },
        { requestId: context.requestId },
      );
    },
  );
}
