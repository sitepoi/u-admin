import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { recordAudit } from '@/lib/server/audit/audit-service';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { getRelayTenant } from '@/lib/server/relay/relay-client';
import { upsertTenantControl } from '@/lib/server/statistics/tenant-control';
import {
  parseJsonBody,
  updateTenantControlRequestSchema,
} from '@/lib/server/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TenantControlRouteContext {
  params: Promise<{ projectId: string; tenantId: string }>;
}

export async function PATCH(
  request: NextRequest,
  routeContext: TenantControlRouteContext,
): Promise<Response> {
  const { projectId, tenantId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'PATCH /api/platform/projects/[projectId]/tenants/[tenantId]/control',
      auth: 'session',
      permission: 'tenant:write',
      mutation: true,
      rateLimit: { limit: 30, windowMs: 60_000 },
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const body = await parseJsonBody(request, updateTenantControlRequestSchema);
      const tenant = await getRelayTenant(tenantId);
      if (!tenant || tenant.projectId !== projectId) {
        throw ApiError.notFound('tenant');
      }

      const control = await upsertTenantControl({
        tenant,
        actorEmail: context.session.email,
        updates: body,
      });

      await recordAudit({
        actor: {
          uid: context.session.uid,
          email: context.session.email,
          role: context.session.role,
        },
        action: 'tenant.control_updated',
        targetType: 'tenant',
        targetId: tenant.tenantId,
        tenantId: tenant.tenantId,
        result: 'success',
        metadata: {
          projectId,
          changedFields: Object.keys(body),
        },
        context: context.auditContext,
      });

      return jsonOk({ control }, { requestId: context.requestId });
    },
  );
}
