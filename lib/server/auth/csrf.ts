import 'server-only';

import { randomBytes } from 'node:crypto';

import {
  PLATFORM_CSRF_COOKIE,
  PLATFORM_CSRF_HEADER,
  PLATFORM_SESSION_COOKIE,
} from '@/lib/shared/constants';
import { isCsrfTokenValid, readCookie } from '@/lib/edge/cookies';
import { ApiError } from '@/lib/server/errors';

/** 32 random bytes, base64url encoded (43 characters). */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

/**
 * Rejects a mutation whose Origin is not the platform origin. This blocks
 * cross-site form posts even before the CSRF token is inspected.
 */
export function assertOriginAllowed(request: Request, acceptedOrigins: readonly string[]): void {
  const rawOrigin = request.headers.get('origin');
  if (!rawOrigin) {
    throw ApiError.forbidden('Missing Origin header on a state-changing request.');
  }

  const origin = normalizeOrigin(rawOrigin);
  if (!origin) {
    throw ApiError.forbidden('Invalid Origin header.');
  }

  const accepted = acceptedOrigins
    .map((candidate) => normalizeOrigin(candidate))
    .filter((candidate): candidate is string => candidate !== null);

  if (!accepted.includes(origin)) {
    throw ApiError.forbidden('Origin is not allowed to perform this action.');
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw ApiError.forbidden('Cross-site requests are not allowed.');
  }
}

/**
 * Double-submit CSRF check: the `x-csrf-token` header must equal the
 * `__Host-platform_csrf` cookie in constant time.
 */
export function assertCsrfToken(request: Request): void {
  const headerToken = request.headers.get(PLATFORM_CSRF_HEADER);
  const cookieToken = readCookie(request.headers.get('cookie'), PLATFORM_CSRF_COOKIE);
  if (!isCsrfTokenValid(headerToken, cookieToken)) {
    throw ApiError.forbidden('Invalid or missing CSRF token.');
  }
}

/** True when the request carries a platform session cookie. */
export function hasSessionCookie(request: Request): boolean {
  return Boolean(readCookie(request.headers.get('cookie'), PLATFORM_SESSION_COOKIE));
}
