import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { recordAudit } from '@/lib/server/audit/audit-service';
import { verifyActorIdToken } from '@/lib/server/auth/actor-token';
import { deliverSecret } from '@/lib/server/secret-api-client/client';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { deliverSecretRequestSchema, parseJsonBody } from '@/lib/server/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DeliverRouteContext {
  params: Promise<{ secretId: string }>;
}

export async function POST(
  request: NextRequest,
  routeContext: DeliverRouteContext,
): Promise<Response> {
  const { secretId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'POST /api/platform/secrets/[secretId]/deliver',
      auth: 'session',
      permission: 'secret:deliver',
      mutation: true,
      rateLimit: { limit: 10, windowMs: 60_000 },
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const body = await parseJsonBody(request, deliverSecretRequestSchema);

      await verifyActorIdToken({
        idToken: body.idToken,
        session: context.session,
        allowedRoles: ['owner', 'admin'],
        requireFreshAuthentication: false,
      });

      await recordAudit({
        actor: {
          uid: context.session.uid,
          email: context.session.email,
          role: context.session.role,
        },
        action: 'secret.deliver_requested',
        targetType: 'secret',
        targetId: secretId,
        tenantId: null,
        result: 'success',
        metadata: { mode: body.mode, reason: body.reason },
        context: context.auditContext,
      });

      const delivery = await deliverSecret(
        { requestId: context.requestId },
        {
          secretId,
          mode: body.mode,
          reason: body.reason,
          actorIdToken: body.idToken,
        },
      );

      return jsonOk({ delivery }, { requestId: context.requestId });
    },
  );
}
