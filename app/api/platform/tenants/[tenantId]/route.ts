import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { assertRoleCan } from '@/lib/server/auth/roles';
import { getTenantOrThrow, updateTenantMetadata } from '@/lib/server/tenants/tenant-service';
import { getTenantSnapshots } from '@/lib/server/reporting/collector';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { parseJsonBody, updateTenantRequestSchema } from '@/lib/server/validation/schemas';
import { recordAudit } from '@/lib/server/audit/audit-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TenantRouteContext {
  params: Promise<{ tenantId: string }>;
}

export async function GET(
  request: NextRequest,
  routeContext: TenantRouteContext,
): Promise<Response> {
  const { tenantId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/tenants/[tenantId]',
      auth: 'session',
      permission: 'platform:read',
    },
    async (context) => {
      const tenant = await getTenantOrThrow(tenantId);
      const snapshots = await getTenantSnapshots(tenant.tenantId);

      return jsonOk({ tenant, snapshots }, { requestId: context.requestId });
    },
  );
}

export async function PATCH(
  request: NextRequest,
  routeContext: TenantRouteContext,
): Promise<Response> {
  const { tenantId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'PATCH /api/platform/tenants/[tenantId]',
      auth: 'session',
      mutation: true,
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const body = await parseJsonBody(request, updateTenantRequestSchema);
      const isArchive = body.status === 'archived';

      // Two different permissions can apply to the same endpoint, so the check
      // happens here instead of in the wrapper.
      assertRoleCan(context.session.role, isArchive ? 'tenant:archive' : 'tenant:write');

      const tenant = await updateTenantMetadata(tenantId, body, { archive: isArchive });

      const changedFields = Object.entries(body)
        .filter(([fieldName, fieldValue]) => fieldName !== 'reason' && fieldValue !== undefined)
        .map(([fieldName]) => fieldName);

      await recordAudit({
        actor: {
          uid: context.session.uid,
          email: context.session.email,
          role: context.session.role,
        },
        action: isArchive ? 'tenant.archived' : 'tenant.updated',
        targetType: 'tenant',
        targetId: tenant.tenantId,
        tenantId: tenant.tenantId,
        result: 'success',
        metadata: {
          fields: changedFields,
          reason: body.reason ?? null,
          status: tenant.status,
        },
        context: context.auditContext,
      });

      return jsonOk({ tenant }, { requestId: context.requestId });
    },
  );
}
