import 'server-only';

import type { NextRequest } from 'next/server';

import { timingSafeEqualString } from '@/lib/edge/cookies';
import { ApiError } from '@/lib/server/errors';
import { recordAudit } from '@/lib/server/audit/audit-service';
import { refreshReporting } from '@/lib/server/reporting/collector';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CRON_ACTOR = {
  uid: 'system:reporting-cron',
  email: 'reporting-cron@platform.invalid',
  role: 'system' as const,
};

function isCronAuthorized(request: NextRequest): boolean {
  const cronSecret = (process.env.PLATFORM_REPORTING_CRON_SECRET ?? '').trim();
  if (!cronSecret) return false;

  const authorization = request.headers.get('authorization') ?? '';
  const bearerToken = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const headerSecret = (request.headers.get('x-cron-secret') ?? '').trim();
  const providedSecret = bearerToken || headerSecret;

  return providedSecret.length > 0 && timingSafeEqualString(providedSecret, cronSecret);
}

async function executeRefresh(
  requestId: string,
  actor: { uid: string; email: string; role: 'system' } | { uid: string; email: string; role: 'owner' | 'admin' | 'operator' | 'auditor' },
  context: { ip: string; userAgent: string; requestId: string },
): Promise<Response> {
  const result = await refreshReporting({ requestId });

  await recordAudit({
    actor,
    action: 'reporting.refreshed',
    targetType: 'platform',
    targetId: result.platformSnapshot.snapshotId,
    result: 'success',
    metadata: {
      period: result.period,
      tenantCount: result.tenantCount,
      tenantFailureCount: result.tenantFailureCount,
      status: result.platformSnapshot.status,
      reads: result.cost.reads,
      writes: result.cost.writes + 1,
    },
    context,
  });

  return jsonOk(
    {
      period: result.period,
      collectedAt: result.collectedAt,
      tenantCount: result.tenantCount,
      tenantFailureCount: result.tenantFailureCount,
      platformSnapshot: result.platformSnapshot,
      cost: {
        ...result.cost,
        // The audit entry is a write too.
        writes: result.cost.writes + 1,
        operations: result.cost.operations + 1,
      },
    },
    { requestId },
  );
}

/**
 * Vercel Cron issues GET requests. Only the shared cron secret can use this
 * method; interactive users must use POST (which is CSRF protected).
 */
export async function GET(request: NextRequest): Promise<Response> {
  if (!isCronAuthorized(request)) {
    return runApiRoute(
      request,
      {
        route: 'GET /api/platform/reporting/refresh',
        auth: 'public',
        rateLimit: { limit: 10, windowMs: 60_000 },
      },
      async () => {
        throw new ApiError('UNAUTHORIZED', 'A valid cron secret is required for this method.');
      },
    );
  }

  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/reporting/refresh:cron',
      auth: 'public',
      rateLimit: { limit: 6, windowMs: 60_000 },
    },
    async (context) => executeRefresh(context.requestId, CRON_ACTOR, context.auditContext),
  );
}

/**
 * Manual refresh (owner/admin) or Vercel Cron (bearer secret).
 * Cron has no Origin header, so it takes the non-mutation code path; the shared
 * secret is compared in constant time.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (isCronAuthorized(request)) {
    return runApiRoute(
      request,
      {
        route: 'POST /api/platform/reporting/refresh:cron',
        auth: 'public',
        rateLimit: { limit: 6, windowMs: 60_000 },
      },
      async (context) => executeRefresh(context.requestId, CRON_ACTOR, context.auditContext),
    );
  }

  return runApiRoute(
    request,
    {
      route: 'POST /api/platform/reporting/refresh',
      auth: 'session',
      permission: 'reporting:refresh',
      mutation: true,
      rateLimit: { limit: 3, windowMs: 300_000 },
    },
    async (context) => {
      if (!context.session) {
        throw new Error('Session missing after authorisation.');
      }
      return executeRefresh(
        context.requestId,
        {
          uid: context.session.uid,
          email: context.session.email,
          role: context.session.role,
        },
        context.auditContext,
      );
    },
  );
}
