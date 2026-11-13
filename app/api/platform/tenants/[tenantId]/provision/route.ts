import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { provisionTenant } from '@/lib/server/tenants/provisioning';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProvisionRouteContext {
  params: Promise<{ tenantId: string }>;
}

/**
 * Starts (or retries) tenant provisioning.
 *
 * A provisioning failure is a workflow outcome, not a transport error: the
 * response is 200 with `outcome: 'failed'` and the persisted `lastError`. The
 * tenant record keeps status `failed` and can be retried.
 */
export async function POST(
  request: NextRequest,
  routeContext: ProvisionRouteContext,
): Promise<Response> {
  const { tenantId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'POST /api/platform/tenants/[tenantId]/provision',
      auth: 'session',
      permission: 'tenant:provision',
      mutation: true,
      rateLimit: { limit: 10, windowMs: 60_000 },
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const result = await provisionTenant({
        tenantId,
        actor: context.session,
        auditContext: context.auditContext,
      });

      return jsonOk(
        {
          tenant: result.tenant,
          attemptId: result.attemptId,
          outcome: result.outcome,
          lastError: result.lastError,
        },
        { requestId: context.requestId },
      );
    },
  );
}
