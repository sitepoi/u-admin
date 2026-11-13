import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { isPlatformRole } from '@/lib/shared/constants';
import type { PlatformTokenVerifier, VerifiedIdentity } from '@/lib/server/auth/token-verifier';

/**
 * Deterministic verifier used exclusively by local Playwright runs.
 *
 * It is only reachable when `isE2eMode()` is true, which requires
 * PLATFORM_E2E_MODE=true and refuses to activate when NODE_ENV=production or
 * when running on Vercel. See lib/server/env.ts.
 *
 * ID token grammar: `e2e:<role>:<email>[:<authTimeUnixSeconds>]`
 */

const E2E_SECRET_FALLBACK = 'platform-admin-e2e-dev-secret-not-for-production';

interface E2eSessionPayload {
  uid: string;
  email: string;
  role: string;
  authTime: number;
  expiresAt: number;
}

function getE2eSecret(): string {
  return process.env.PLATFORM_E2E_SESSION_SECRET || E2E_SECRET_FALLBACK;
}

function signPayload(encodedPayload: string): string {
  return createHmac('sha256', getE2eSecret()).update(encodedPayload).digest('base64url');
}

function createSessionValue(payload: E2eSessionPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

function parseE2eIdToken(idToken: string): VerifiedIdentity {
  const parts = idToken.split(':');
  if (parts[0] !== 'e2e') {
    throw new Error('Invalid E2E token.');
  }
  const role = parts[1] ?? '';
  if (!isPlatformRole(role)) {
    throw new Error('Invalid E2E role.');
  }
  const email = parts[2] && parts[2].length > 0 ? parts[2] : `${role}@e2e.uniconhub.test`;
  const explicitAuthTime = Number.parseInt(parts[3] ?? '', 10);
  const authTime = Number.isFinite(explicitAuthTime)
    ? explicitAuthTime
    : Math.floor(Date.now() / 1000);

  return {
    uid: `e2e-${role}`,
    email,
    emailVerified: true,
    platformRole: role,
    secondFactorPresent: true,
    authTime,
    signInProvider: 'password',
  };
}

export const e2eTokenVerifier: PlatformTokenVerifier = {
  async verifyIdToken(idToken: string): Promise<VerifiedIdentity> {
    return parseE2eIdToken(idToken);
  },

  async verifySessionCookie(sessionCookieValue: string): Promise<VerifiedIdentity> {
    const [encodedPayload, providedSignature] = sessionCookieValue.split('.');
    if (!encodedPayload || !providedSignature) {
      throw new Error('Invalid E2E session cookie.');
    }
    const expectedSignature = signPayload(encodedPayload);
    const providedBuffer = Buffer.from(providedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new Error('Invalid E2E session signature.');
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as E2eSessionPayload;
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt * 1000 < Date.now()) {
      throw new Error('E2E session expired.');
    }
    if (!isPlatformRole(payload.role)) {
      throw new Error('Invalid E2E role.');
    }

    return {
      uid: payload.uid,
      email: payload.email,
      emailVerified: true,
      platformRole: payload.role,
      secondFactorPresent: true,
      authTime: payload.authTime,
      signInProvider: 'password',
    };
  },

  async createSessionCookie(idToken: string, ttlSeconds: number): Promise<string> {
    const identity = parseE2eIdToken(idToken);
    if (!identity.platformRole || !identity.email) {
      throw new Error('Invalid E2E identity.');
    }
    return createSessionValue({
      uid: identity.uid,
      email: identity.email,
      role: identity.platformRole,
      authTime: identity.authTime,
      expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    });
  },

  async revokeRefreshTokens(): Promise<void> {
    // No-op in E2E mode.
  },
};
