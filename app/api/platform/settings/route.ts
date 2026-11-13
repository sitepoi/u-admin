import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { recordAudit } from '@/lib/server/audit/audit-service';
import {
  getPlatformSettings,
  updatePlatformSettings,
} from '@/lib/server/settings/settings-service';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { parseJsonBody, settingsUpdateRequestSchema } from '@/lib/server/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'GET /api/platform/settings',
      auth: 'session',
      permission: 'platform:read',
    },
    async (context) => {
      const settings = await getPlatformSettings();
      return jsonOk({ settings }, { requestId: context.requestId });
    },
  );
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'PATCH /api/platform/settings',
      auth: 'session',
      permission: 'settings:manage',
      mutation: true,
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const body = await parseJsonBody(request, settingsUpdateRequestSchema);
      if (Object.keys(body).length === 0) {
        throw ApiError.invalidRequest('No settings were provided.');
      }

      const settings = await updatePlatformSettings(body, context.session.uid);

      await recordAudit({
        actor: {
          uid: context.session.uid,
          email: context.session.email,
          role: context.session.role,
        },
        action: 'settings.updated',
        targetType: 'platform',
        targetId: 'platform_settings',
        result: 'success',
        metadata: { fields: Object.keys(body) },
        context: context.auditContext,
      });

      return jsonOk({ settings }, { requestId: context.requestId });
    },
  );
}
