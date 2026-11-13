import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { listSecretMetadata } from '@/lib/server/secret-api-client/client';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { parseSearchParams, secretMetadataQuerySchema } from '@/lib/server/validation/schemas';
import { normalizeTenantId, validateTenantId } from '@/lib/server/tenants/tenant-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/secret-metadata',
      auth: 'session',
      permission: 'secret:metadata:read',
    },
    async (context) => {
      const query = parseSearchParams(request.url, secretMetadataQuerySchema);

      let tenantId: string | undefined;
      if (query.tenantId) {
        const validation = validateTenantId(normalizeTenantId(query.tenantId));
        if (!validation.ok) {
          throw ApiError.invalidRequest(validation.message);
        }
        tenantId = validation.tenantId;
      }

      const secrets = await listSecretMetadata(
        { requestId: context.requestId },
        tenantId,
        { useCache: false },
      );

      return jsonOk({ secrets }, { requestId: context.requestId });
    },
  );
}
