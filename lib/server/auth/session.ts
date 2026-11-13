import 'server-only';

import { ApiError } from '@/lib/server/errors';
import { getPlatformConfig } from '@/lib/server/env';
import { isEmailAllowlisted } from '@/lib/server/auth/allowlist';
import { getTokenVerifier } from '@/lib/server/auth/token-verifier-provider';
import type { VerifiedIdentity } from '@/lib/server/auth/token-verifier';
import { readCookie } from '@/lib/edge/cookies';
import {
  PLATFORM_SESSION_COOKIE,
  isPlatformRole,
  type PlatformRole,
} from '@/lib/shared/constants';

export interface PlatformSession {
  uid: string;
  email: string;
  role: PlatformRole;
  /** Unix seconds of the most recent interactive authentication. */
  authTime: number;
  secondFactorPresent: boolean;
  /** Unix seconds when the session cookie was issued. */
  issuedAt: number;
}

/**
 * Converts verified claims into a platform session.
 *
 * Order matters:
 * 1. the email must be allowlisted (Firebase Auth alone is not enough),
 * 2. MFA must be present on the token,
 * 3. the custom claim must be a known platform role.
 */
export function sessionFromIdentity(identity: VerifiedIdentity): PlatformSession {
  const config = getPlatformConfig();

  if (!identity.email || !isEmailAllowlisted(identity.email, config.adminEmails)) {
    throw ApiError.unauthorized('This account is not authorised for the platform.');
  }

  if (!identity.secondFactorPresent) {
    throw ApiError.mfaRequired();
  }

  if (!identity.platformRole || !isPlatformRole(identity.platformRole)) {
    throw ApiError.forbidden('Your account has no platform role.');
  }

  return {
    uid: identity.uid,
    email: identity.email,
    role: identity.platformRole,
    authTime: identity.authTime,
    secondFactorPresent: true,
    issuedAt: Math.floor(Date.now() / 1000),
  };
}

export interface CreatedSession {
  session: PlatformSession;
  sessionCookieValue: string;
  sessionTtlSeconds: number;
}

/**
 * Exchanges a Firebase ID token for a `__Host-` session cookie value.
 * Called only by POST /api/auth/session.
 */
export async function createPlatformSession(idToken: string): Promise<CreatedSession> {
  const config = getPlatformConfig();
  const verifier = getTokenVerifier();

  const identity = await verifier.verifyIdToken(idToken);
  const session = sessionFromIdentity(identity);
  const sessionCookieValue = await verifier.createSessionCookie(
    idToken,
    config.sessionTtlSeconds,
  );

  return {
    session,
    sessionCookieValue,
    sessionTtlSeconds: config.sessionTtlSeconds,
  };
}

/**
 * Verifies the session cookie from an incoming request.
 * Throws `UNAUTHORIZED` for a missing/invalid cookie and `MFA_REQUIRED` when the
 * underlying token lacks a second factor.
 */
export async function readPlatformSession(request: Request): Promise<PlatformSession> {
  const sessionCookieValue = readCookie(
    request.headers.get('cookie'),
    PLATFORM_SESSION_COOKIE,
  );
  if (!sessionCookieValue) {
    throw ApiError.unauthorized('A platform session is required.');
  }
  return getSessionFromCookieValue(sessionCookieValue);
}

export async function getSessionFromCookieValue(
  sessionCookieValue: string,
): Promise<PlatformSession> {
  const verifier = getTokenVerifier();
  let identity: VerifiedIdentity;
  try {
    identity = await verifier.verifySessionCookie(sessionCookieValue);
  } catch {
    throw ApiError.unauthorized('Your session is invalid or has expired.');
  }
  return sessionFromIdentity(identity);
}

/** Non-throwing variant used by server components. */
export async function getSessionOrNull(request: Request): Promise<PlatformSession | null> {
  try {
    return await readPlatformSession(request);
  } catch {
    return null;
  }
}

export function isFreshAuthentication(
  session: PlatformSession,
  maxAgeSeconds: number,
  nowMs: number = Date.now(),
): boolean {
  return isAuthTimeFresh(session.authTime, maxAgeSeconds, nowMs);
}

export function isAuthTimeFresh(
  authTimeSeconds: number,
  maxAgeSeconds: number,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(authTimeSeconds) || authTimeSeconds <= 0) return false;
  const nowSeconds = Math.floor(nowMs / 1000);
  const ageSeconds = nowSeconds - authTimeSeconds;
  if (ageSeconds < -60) return false; // auth_time in the future: reject
  return ageSeconds <= maxAgeSeconds;
}
