import 'server-only';

import type { NextRequest } from 'next/server';

import { TENANT_STATUSES, type TenantStatus } from '@/lib/shared/constants';
import { ApiError } from '@/lib/server/errors';
import {
  createTenant,
  listTenants,
  toTenantListItem,
} from '@/lib/server/tenants/tenant-service';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { parseJsonBody, createTenantRequestSchema } from '@/lib/server/validation/schemas';
import { recordAudit } from '@/lib/server/audit/audit-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseStatusFilter(rawStatus: string | null): TenantStatus | 'all' {
  if (!rawStatus || rawStatus === 'all') return 'all';
  if ((TENANT_STATUSES as readonly string[]).includes(rawStatus)) {
    return rawStatus as TenantStatus;
  }
  throw ApiError.invalidRequest('Unknown tenant status filter.');
}

export async function GET(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/tenants',
      auth: 'session',
      permission: 'platform:read',
    },
    async (context) => {
      const url = new URL(request.url);
      const search = url.searchParams.get('search') ?? undefined;
      const status = parseStatusFilter(url.searchParams.get('status'));

      const tenants = await listTenants({ search, status });
      return jsonOk(
        { tenants: tenants.map(toTenantListItem) },
        { requestId: context.requestId },
      );
    },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'POST /api/platform/tenants',
      auth: 'session',
      permission: 'tenant:write',
      mutation: true,
      rateLimit: { limit: 20, windowMs: 60_000 },
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const body = await parseJsonBody(request, createTenantRequestSchema);
      const tenant = await createTenant(body, context.session);

      await recordAudit({
        actor: {
          uid: context.session.uid,
          email: context.session.email,
          role: context.session.role,
        },
        action: 'tenant.created',
        targetType: 'tenant',
        targetId: tenant.tenantId,
        tenantId: tenant.tenantId,
        result: 'success',
        metadata: {
          displayName: tenant.displayName,
          cmsProjectId: tenant.cmsProjectId,
          deliveryMode: tenant.deliveryMode,
        },
        context: context.auditContext,
      });

      return jsonOk({ tenant }, { status: 201, requestId: context.requestId });
    },
  );
}
