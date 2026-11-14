import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { parseJsonBody, createProjectRequestSchema } from '@/lib/server/validation/schemas';
import { createProject, listProjects } from '@/lib/server/projects/project-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/projects',
      auth: 'session',
      permission: 'platform:read',
    },
    async (context) => {
      const projects = await listProjects();
      return jsonOk({ projects }, { requestId: context.requestId });
    },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'POST /api/platform/projects',
      auth: 'session',
      permission: 'project:manage',
      mutation: true,
      rateLimit: { limit: 10, windowMs: 60_000 },
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const body = await parseJsonBody(request, createProjectRequestSchema);
      const project = await createProject(body, context.session, context.auditContext);

      return jsonOk({ project }, { status: 201, requestId: context.requestId });
    },
  );
}
