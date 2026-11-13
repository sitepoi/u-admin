import 'server-only';

import type { NextRequest } from 'next/server';

import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness probe for the access proxy / uptime monitor.
 * No configuration, version or tenant information is returned.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/health',
      auth: 'public',
      rateLimit: { limit: 60, windowMs: 60_000 },
    },
    async (context) =>
      jsonOk(
        { status: 'ok', time: new Date().toISOString() },
        { requestId: context.requestId },
      ),
  );
}
