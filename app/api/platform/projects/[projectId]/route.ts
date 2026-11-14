import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { parseJsonBody, updateProjectRequestSchema } from '@/lib/server/validation/schemas';
import { getProjectOrThrow, updateProject } from '@/lib/server/projects/project-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(
  request: NextRequest,
  routeContext: ProjectRouteContext,
): Promise<Response> {
  const { projectId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/projects/[projectId]',
      auth: 'session',
      permission: 'platform:read',
    },
    async (context) => {
      const project = await getProjectOrThrow(projectId);
      return jsonOk({ project }, { requestId: context.requestId });
    },
  );
}

export async function PATCH(
  request: NextRequest,
  routeContext: ProjectRouteContext,
): Promise<Response> {
  const { projectId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'PATCH /api/platform/projects/[projectId]',
      auth: 'session',
      permission: 'project:manage',
      mutation: true,
      rateLimit: { limit: 30, windowMs: 60_000 },
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const body = await parseJsonBody(request, updateProjectRequestSchema);
      const project = await updateProject(
        projectId,
        body,
        context.session,
        context.auditContext,
      );

      return jsonOk({ project }, { requestId: context.requestId });
    },
  );
}
