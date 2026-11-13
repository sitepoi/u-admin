import 'server-only';

import type { NextRequest } from 'next/server';

import {
  PLATFORM_CSRF_COOKIE,
  PLATFORM_SESSION_COOKIE,
} from '@/lib/shared/constants';
import { ApiError } from '@/lib/server/errors';
import { getPlatformConfig, isE2eMode } from '@/lib/server/env';
import { createPlatformSession } from '@/lib/server/auth/session';
import { getTokenVerifier } from '@/lib/server/auth/token-verifier-provider';
import { generateCsrfToken } from '@/lib/server/auth/csrf';
import {
  csrfCookieOptions,
  sessionCookieOptions,
} from '@/lib/server/auth/cookies';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { parseJsonBody, sessionRequestSchema } from '@/lib/server/validation/schemas';
import { recordAudit } from '@/lib/server/audit/audit-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exchanges a Firebase ID token for a `__Host-` session cookie.
 *
 * Refuses:
 * - non-allowlisted emails,
 * - tokens without a second factor,
 * - tokens without a valid platformRole claim.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'POST /api/auth/session',
      auth: 'public',
      mutation: true,
      rateLimit: { limit: 10, windowMs: 60_000 },
    },
    async (context) => {
      const body = await parseJsonBody(request, sessionRequestSchema);

      let idToken = body.idToken ?? '';
      if (body.e2eActor) {
        if (!isE2eMode()) {
          throw ApiError.invalidRequest('The local test sign-in helper is disabled.');
        }
        const config = getPlatformConfig();
        const email = config.adminEmails[0];
        if (!email) {
          throw ApiError.invalidRequest('PLATFORM_ADMIN_EMAILS must contain an address for E2E mode.');
        }
        idToken = `e2e:${body.e2eActor}:${email}`;
      }

      if (!idToken) {
        throw ApiError.invalidRequest('An ID token is required.');
      }

      try {
        const created = await createPlatformSession(idToken);

        const response = jsonOk(
          {
            role: created.session.role,
            email: created.session.email,
            expiresInSeconds: created.sessionTtlSeconds,
          },
          { requestId: context.requestId },
        );

        response.cookies.set({
          name: PLATFORM_SESSION_COOKIE,
          value: created.sessionCookieValue,
          ...sessionCookieOptions(created.sessionTtlSeconds),
        });
        response.cookies.set({
          name: PLATFORM_CSRF_COOKIE,
          value: generateCsrfToken(),
          ...csrfCookieOptions(created.sessionTtlSeconds),
        });

        await recordAudit({
          actor: {
            uid: created.session.uid,
            email: created.session.email,
            role: created.session.role,
          },
          action: 'auth.session_created',
          targetType: 'session',
          targetId: created.session.uid,
          result: 'success',
          metadata: { signInProvider: 'firebase', secondFactor: true },
          context: context.auditContext,
        });

        return response;
      } catch (error) {
        await auditSessionDenial(idToken, error, context.auditContext, context.requestId);
        throw error;
      }
    },
  );
}

async function auditSessionDenial(
  idToken: string,
  error: unknown,
  auditContext: { ip: string; userAgent: string; requestId: string },
  requestId: string,
): Promise<void> {
  const apiError = error instanceof ApiError ? error : null;

  let actor: { uid: string; email: string; role: 'system' | 'owner' | 'admin' | 'operator' | 'auditor' } =
    {
      uid: 'unknown',
      email: 'unknown',
      role: 'system',
    };

  try {
    const identity = await getTokenVerifier().verifyIdToken(idToken);
    actor = {
      uid: identity.uid,
      email: identity.email ?? 'unknown',
      role: identity.platformRole ?? 'system',
    };
  } catch {
    // The token itself is invalid: keep the placeholder actor.
  }

  await recordAudit({
    actor,
    action: apiError?.code === 'MFA_REQUIRED' ? 'auth.mfa_missing' : 'auth.denied',
    targetType: 'session',
    targetId: actor.uid,
    result: 'denied',
    metadata: { code: apiError?.code ?? 'UNKNOWN', requestId },
    context: auditContext,
  });
}
