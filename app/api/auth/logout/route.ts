import 'server-only';

import type { NextRequest } from 'next/server';

import {
  PLATFORM_CSRF_COOKIE,
  PLATFORM_SESSION_COOKIE,
} from '@/lib/shared/constants';
import { getSessionOrNull } from '@/lib/server/auth/session';
import { getTokenVerifier } from '@/lib/server/auth/token-verifier-provider';
import { csrfCookieOptions, sessionCookieOptions } from '@/lib/server/auth/cookies';
import { runApiRoute } from '@/lib/server/http/route-handler';
import { jsonOk } from '@/lib/server/http/respond';
import { recordAudit } from '@/lib/server/audit/audit-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Clears both platform cookies and revokes the user's refresh tokens.
 * The endpoint is intentionally tolerant of an expired session so a user can
 * always sign out.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return runApiRoute(
    request,
    {
      route: 'POST /api/auth/logout',
      auth: 'public',
      mutation: true,
      rateLimit: { limit: 20, windowMs: 60_000 },
    },
    async (context) => {
      const session = await getSessionOrNull(request);

      if (session) {
        try {
          await getTokenVerifier().revokeRefreshTokens(session.uid);
        } catch {
          // Cookie clearing below still ends this browser session.
        }
      }

      const response = jsonOk({ loggedOut: true }, { requestId: context.requestId });

      response.cookies.set({
        name: PLATFORM_SESSION_COOKIE,
        value: '',
        ...sessionCookieOptions(0),
      });
      response.cookies.set({
        name: PLATFORM_CSRF_COOKIE,
        value: '',
        ...csrfCookieOptions(0),
      });

      if (session) {
        await recordAudit({
          actor: { uid: session.uid, email: session.email, role: session.role },
          action: 'auth.logout',
          targetType: 'session',
          targetId: session.uid,
          result: 'success',
          context: context.auditContext,
        });
      }

      return response;
    },
  );
}
