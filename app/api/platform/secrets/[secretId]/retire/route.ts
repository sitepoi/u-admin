import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { recordAudit } from '@/lib/server/audit/audit-service';
import { verifyActorIdToken } from '@/lib/server/auth/actor-token';
import { retireSecret } from '@/lib/server/secret-api-client/client';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { parseJsonBody, retireSecretRequestSchema } from '@/lib/server/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RetireRouteContext {
  params: Promise<{ secretId: string }>;
}

/**
 * Owner-only retirement proxy. The Secret API independently verifies the owner
 * role and MFA before marking the secret retired.
 */
export async function POST(
  request: NextRequest,
  routeContext: RetireRouteContext,
): Promise<Response> {
  const { secretId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'POST /api/platform/secrets/[secretId]/retire',
      auth: 'session',
      permission: 'secret:retire',
      mutation: true,
      rateLimit: { limit: 5, windowMs: 60_000 },
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const body = await parseJsonBody(request, retireSecretRequestSchema);

      await verifyActorIdToken({
        idToken: body.idToken,
        session: context.session,
        allowedRoles: ['owner'],
        requireFreshAuthentication: false,
      });

      await recordAudit({
        actor: {
          uid: context.session.uid,
          email: context.session.email,
          role: context.session.role,
        },
        action: 'secret.retire_requested',
        targetType: 'secret',
        targetId: secretId,
        tenantId: null,
        result: 'success',
        metadata: { reason: body.reason },
        context: context.auditContext,
      });

      const retirement = await retireSecret(
        { requestId: context.requestId },
        {
          secretId,
          reason: body.reason,
          actorIdToken: body.idToken,
        },
      );

      return jsonOk({ retirement }, { requestId: context.requestId });
    },
  );
}
