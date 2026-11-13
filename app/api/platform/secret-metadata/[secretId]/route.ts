import 'server-only';

import type { NextRequest } from 'next/server';

import { getSecretMetadata } from '@/lib/server/secret-api-client/client';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SecretRouteContext {
  params: Promise<{ secretId: string }>;
}

export async function GET(
  request: NextRequest,
  routeContext: SecretRouteContext,
): Promise<Response> {
  const { secretId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/secret-metadata/[secretId]',
      auth: 'session',
      permission: 'secret:metadata:read',
    },
    async (context) => {
      const secret = await getSecretMetadata({ requestId: context.requestId }, secretId);
      return jsonOk({ secret }, { requestId: context.requestId });
    },
  );
}
