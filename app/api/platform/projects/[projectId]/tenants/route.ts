import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { recordAudit } from '@/lib/server/audit/audit-service';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import {
  parseJsonBody,
  createProjectTenantRequestSchema,
} from '@/lib/server/validation/schemas';
import { getProjectOrThrow } from '@/lib/server/projects/project-service';
import {
  createProjectTenant,
  listProjectTenants,
} from '@/lib/server/projects/project-data-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProjectTenantsRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(
  request: NextRequest,
  routeContext: ProjectTenantsRouteContext,
): Promise<Response> {
  const { projectId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/projects/[projectId]/tenants',
      auth: 'session',
      permission: 'platform:read',
      rateLimit: { limit: 60, windowMs: 60_000 },
    },
    async (context) => {
      const project = await getProjectOrThrow(projectId);
      const tenants = await listProjectTenants(project);
      return jsonOk({ project, tenants }, { requestId: context.requestId });
    },
  );
}

export async function POST(
  request: NextRequest,
  routeContext: ProjectTenantsRouteContext,
): Promise<Response> {
  const { projectId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'POST /api/platform/projects/[projectId]/tenants',
      auth: 'session',
      permission: 'tenant:write',
      mutation: true,
      rateLimit: { limit: 20, windowMs: 60_000 },
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const project = await getProjectOrThrow(projectId);
      const body = await parseJsonBody(request, createProjectTenantRequestSchema);
      const tenant = await createProjectTenant(project, body);

      await recordAudit({
        actor: {
          uid: context.session.uid,
          email: context.session.email,
          role: context.session.role,
        },
        action: 'project.tenant_created',
        targetType: 'tenant',
        targetId: tenant.tenantId,
        tenantId: tenant.tenantId,
        result: 'success',
        metadata: {
          projectId: project.projectId,
          tenantSource: project.tenantSource,
          displayName: tenant.displayName,
        },
        context: context.auditContext,
      });

      return jsonOk({ tenant }, { status: 201, requestId: context.requestId });
    },
  );
}
