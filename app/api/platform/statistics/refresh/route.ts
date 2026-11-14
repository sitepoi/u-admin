import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { recordAudit } from '@/lib/server/audit/audit-service';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { parseJsonBody, refreshTenantStatsRequestSchema } from '@/lib/server/validation/schemas';
import { getRelayTenant } from '@/lib/server/relay/relay-client';
import {
  collectTenantStats,
  getTenantStats,
  saveTenantStats,
} from '@/lib/server/statistics/tenant-stats';
import { syncTenantControlFromStats } from '@/lib/server/statistics/tenant-control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A manual refresh is skipped when the cached numbers are younger than this. */
const MIN_REFRESH_AGE_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'POST /api/platform/statistics/refresh',
      auth: 'session',
      permission: 'reporting:refresh',
      mutation: true,
      rateLimit: { limit: 10, windowMs: 60_000 },
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const body = await parseJsonBody(request, refreshTenantStatsRequestSchema);
      const tenant = await getRelayTenant(body.applicationId ?? body.tenantId);

      if (
        !tenant ||
        tenant.projectId !== body.projectId ||
        tenant.tenantId !== body.tenantId
      ) {
        throw ApiError.notFound('tenant');
      }

      const cached = await getTenantStats(tenant.projectId, tenant.tenantId);
      if (
        cached &&
        cached.status === 'ok' &&
        Date.now() - Date.parse(cached.computedAt) < MIN_REFRESH_AGE_MS
      ) {
        return jsonOk(
          {
            stats: cached,
            skipped: true,
            reason: 'Statistics were refreshed less than 15 minutes ago.',
          },
          { requestId: context.requestId },
        );
      }

      const stats = await collectTenantStats(tenant);
      await saveTenantStats(stats);
      await syncTenantControlFromStats(stats).catch(() => null);

      await recordAudit({
        actor: {
          uid: context.session.uid,
          email: context.session.email,
          role: context.session.role,
        },
        action: 'statistics.refreshed',
        targetType: 'tenant',
        targetId: tenant.tenantId,
        tenantId: tenant.tenantId,
        result: 'success',
        metadata: {
          projectId: tenant.projectId,
          status: stats.status,
          durationMs: stats.durationMs,
          applicationCount: stats.applicationCount,
          totalObjectCount: stats.totalObjectCount,
          websiteBuilderPageCount: stats.websiteBuilderPageCount,
          contentManagerItemCount: stats.contentManagerItemCount,
          errorCount: stats.errors.length,
        },
        context: context.auditContext,
      });

      return jsonOk({ stats, skipped: false }, { requestId: context.requestId });
    },
  );
}
