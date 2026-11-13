import 'server-only';

import type { DecodedIdToken } from 'firebase-admin/auth';

import { getPlatformAuth } from '@/lib/server/firebase/admin';
import type { PlatformRole } from '@/lib/shared/constants';
import { isPlatformRole } from '@/lib/shared/constants';
import type { PlatformTokenVerifier, VerifiedIdentity } from '@/lib/server/auth/token-verifier';

interface FirebaseClaimsShape {
  firebase?: {
    sign_in_provider?: string;
    sign_in_second_factor?: string;
    second_factor_identifier?: string;
    identities?: Record<string, unknown>;
  };
}

/**
 * Maps Firebase claims into the internal identity shape. Deliberately narrow:
 * only allowlisted, MFA-completed, role-bearing identities become sessions.
 */
export function mapDecodedToken(decoded: DecodedIdToken): VerifiedIdentity {
  const firebaseClaims = (decoded as unknown as FirebaseClaimsShape).firebase;
  const rawRole = (decoded as unknown as { platformRole?: unknown }).platformRole;
  const platformRole: PlatformRole | null = isPlatformRole(rawRole) ? rawRole : null;

  return {
    uid: decoded.uid,
    email: typeof decoded.email === 'string' ? decoded.email : null,
    emailVerified: decoded.email_verified === true,
    platformRole,
    secondFactorPresent:
      typeof firebaseClaims?.sign_in_second_factor === 'string' &&
      firebaseClaims.sign_in_second_factor.length > 0,
    authTime: typeof decoded.auth_time === 'number' ? decoded.auth_time : 0,
    signInProvider: firebaseClaims?.sign_in_provider ?? null,
  };
}

export const firebaseTokenVerifier: PlatformTokenVerifier = {
  async verifyIdToken(idToken: string): Promise<VerifiedIdentity> {
    // checkRevoked=true: a disabled user or revoked refresh token stops working
    // immediately instead of after token expiry.
    const decoded = await getPlatformAuth().verifyIdToken(idToken, true);
    return mapDecodedToken(decoded);
  },

  async verifySessionCookie(sessionCookieValue: string): Promise<VerifiedIdentity> {
    const decoded = await getPlatformAuth().verifySessionCookie(sessionCookieValue, true);
    return mapDecodedToken(decoded);
  },

  async createSessionCookie(idToken: string, ttlSeconds: number): Promise<string> {
    return getPlatformAuth().createSessionCookie(idToken, { expiresIn: ttlSeconds * 1000 });
  },

  async revokeRefreshTokens(uid: string): Promise<void> {
    await getPlatformAuth().revokeRefreshTokens(uid);
  },
};
