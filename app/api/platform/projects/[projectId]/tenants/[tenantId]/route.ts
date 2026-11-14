import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { recordAudit } from '@/lib/server/audit/audit-service';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import {
  parseJsonBody,
  updateProjectTenantRequestSchema,
} from '@/lib/server/validation/schemas';
import { getProjectOrThrow } from '@/lib/server/projects/project-service';
import {
  getProjectTenant,
  updateProjectTenant,
} from '@/lib/server/projects/project-data-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProjectTenantRouteContext {
  params: Promise<{ projectId: string; tenantId: string }>;
}

export async function GET(
  request: NextRequest,
  routeContext: ProjectTenantRouteContext,
): Promise<Response> {
  const { projectId, tenantId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/projects/[projectId]/tenants/[tenantId]',
      auth: 'session',
      permission: 'platform:read',
      rateLimit: { limit: 60, windowMs: 60_000 },
    },
    async (context) => {
      const project = await getProjectOrThrow(projectId);
      const tenant = await getProjectTenant(project, tenantId);
      if (!tenant) throw ApiError.notFound('tenant');
      return jsonOk({ project, tenant }, { requestId: context.requestId });
    },
  );
}

export async function PATCH(
  request: NextRequest,
  routeContext: ProjectTenantRouteContext,
): Promise<Response> {
  const { projectId, tenantId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'PATCH /api/platform/projects/[projectId]/tenants/[tenantId]',
      auth: 'session',
      permission: 'tenant:write',
      mutation: true,
      rateLimit: { limit: 30, windowMs: 60_000 },
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const project = await getProjectOrThrow(projectId);
      const body = await parseJsonBody(request, updateProjectTenantRequestSchema);
      const tenant = await updateProjectTenant(project, tenantId, body);

      await recordAudit({
        actor: {
          uid: context.session.uid,
          email: context.session.email,
          role: context.session.role,
        },
        action: 'project.tenant_updated',
        targetType: 'tenant',
        targetId: tenant.tenantId,
        tenantId: tenant.tenantId,
        result: 'success',
        metadata: {
          projectId: project.projectId,
          tenantSource: project.tenantSource,
          changedFields: Object.keys(body),
        },
        context: context.auditContext,
      });

      return jsonOk({ tenant }, { requestId: context.requestId });
    },
  );
}
