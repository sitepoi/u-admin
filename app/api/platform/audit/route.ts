import 'server-only';

import type { NextRequest } from 'next/server';

import { getPlatformStore } from '@/lib/server/firestore/store-provider';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { auditQuerySchema, parseSearchParams } from '@/lib/server/validation/schemas';
import { AUDIT_PAGE_SIZE } from '@/lib/shared/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/audit',
      auth: 'session',
      permission: 'audit:read',
    },
    async (context) => {
      const query = parseSearchParams(request.url, auditQuerySchema);

      const page = await getPlatformStore().listAudit({
        tenantId: query.tenantId ?? null,
        action: query.action ?? null,
        result: query.result ?? null,
        actorUid: query.actorUid ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
        limit: query.limit ?? AUDIT_PAGE_SIZE,
        cursor: query.cursor ?? null,
      });

      return jsonOk(
        { entries: page.entries, nextCursor: page.nextCursor, limit: query.limit ?? AUDIT_PAGE_SIZE },
        { requestId: context.requestId },
      );
    },
  );
}
