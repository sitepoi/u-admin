import 'server-only';

import type { NextRequest } from 'next/server';

import { getReportingSummary } from '@/lib/server/reporting/collector';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Returns cached snapshots only: never fans out to tenant projects. */
export async function GET(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/reporting/summary',
      auth: 'session',
      permission: 'platform:read',
    },
    async (context) => {
      const summary = await getReportingSummary();
      return jsonOk(summary, { requestId: context.requestId });
    },
  );
}
