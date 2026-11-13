import 'server-only';

import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/server/errors';
import { recordAudit } from '@/lib/server/audit/audit-service';
import { verifyActorIdToken } from '@/lib/server/auth/actor-token';
import { revealSecret } from '@/lib/server/secret-api-client/client';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk, NO_STORE_HEADERS } from '@/lib/server/http/respond';
import { parseJsonBody, revealSecretRequestSchema } from '@/lib/server/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RevealRouteContext {
  params: Promise<{ secretId: string }>;
}

/**
 * Owner-only reveal proxy.
 *
 * The Admin app never possesses a decryption key: it verifies the session and
 * the fresh actor token, forwards them to the Secret API, and streams the
 * result back with `Cache-Control: no-store`. Neither the request nor the
 * response is logged.
 */
export async function POST(
  request: NextRequest,
  routeContext: RevealRouteContext,
): Promise<Response> {
  const { secretId } = await routeContext.params;

  return runApiRoute(
    request,
    {
      route: 'POST /api/platform/secrets/[secretId]/reveal',
      auth: 'session',
      permission: 'secret:reveal',
      mutation: true,
      rateLimit: { limit: 5, windowMs: 60_000 },
      deniedAction: 'secret.reveal_denied',
    },
    async (context) => {
      if (!context.session) throw ApiError.unauthorized();

      const body = await parseJsonBody(request, revealSecretRequestSchema);

      try {
        await verifyActorIdToken({
          idToken: body.idToken,
          session: context.session,
          allowedRoles: ['owner'],
          requireFreshAuthentication: true,
        });
      } catch (error) {
        await recordAudit({
          actor: {
            uid: context.session.uid,
            email: context.session.email,
            role: context.session.role,
          },
          action: 'secret.reveal_denied',
          targetType: 'secret',
          targetId: secretId,
          tenantId: null,
          result: 'denied',
          metadata: {
            reason: body.reason,
            code: error instanceof ApiError ? error.code : 'UNKNOWN',
          },
          context: context.auditContext,
        });
        throw error;
      }

      await recordAudit({
        actor: {
          uid: context.session.uid,
          email: context.session.email,
          role: context.session.role,
        },
        action: 'secret.reveal_requested',
        targetType: 'secret',
        targetId: secretId,
        tenantId: null,
        result: 'success',
        metadata: { reason: body.reason },
        context: context.auditContext,
      });

      try {
        const revealedSecret = await revealSecret(
          { requestId: context.requestId },
          {
            secretId,
            reason: body.reason,
            actorIdToken: body.idToken,
          },
        );

        // Intentionally no logging here: the payload contains key material.
        return jsonOk(
          { secret: revealedSecret },
          { requestId: context.requestId, headers: { ...NO_STORE_HEADERS } },
        );
      } catch (error) {
        await recordAudit({
          actor: {
            uid: context.session.uid,
            email: context.session.email,
            role: context.session.role,
          },
          action: 'secret.reveal_denied',
          targetType: 'secret',
          targetId: secretId,
          tenantId: null,
          result: 'error',
          metadata: { code: error instanceof ApiError ? error.code : 'UNKNOWN' },
          context: context.auditContext,
        });
        throw error;
      }
    },
  );
}
