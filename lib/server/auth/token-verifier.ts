import 'server-only';

import type { PlatformRole } from '@/lib/shared/constants';

/**
 * Verified identity claims produced by Firebase Auth (or the E2E verifier).
 * The session layer decides whether these claims may become a platform session.
 */
export interface VerifiedIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  platformRole: PlatformRole | null;
  /** True when Firebase reports `firebase.sign_in_second_factor`. */
  secondFactorPresent: boolean;
  /** Unix seconds; used for the reveal re-authentication window. */
  authTime: number;
  signInProvider: string | null;
}

export interface PlatformTokenVerifier {
  verifyIdToken(idToken: string): Promise<VerifiedIdentity>;
  verifySessionCookie(sessionCookieValue: string): Promise<VerifiedIdentity>;
  createSessionCookie(idToken: string, ttlSeconds: number): Promise<string>;
  revokeRefreshTokens(uid: string): Promise<void>;
}
