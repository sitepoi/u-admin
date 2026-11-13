import 'server-only';

import { isE2eMode } from '@/lib/server/env';
import { e2eTokenVerifier } from '@/lib/server/auth/e2e-token-verifier';
import { firebaseTokenVerifier } from '@/lib/server/auth/firebase-token-verifier';
import type { PlatformTokenVerifier } from '@/lib/server/auth/token-verifier';

let overrideVerifier: PlatformTokenVerifier | null = null;

export function getTokenVerifier(): PlatformTokenVerifier {
  if (overrideVerifier) return overrideVerifier;
  return isE2eMode() ? e2eTokenVerifier : firebaseTokenVerifier;
}

/** Test-only seam used by the Vitest integration suite. */
export function setTokenVerifierForTesting(verifier: PlatformTokenVerifier | null): void {
  overrideVerifier = verifier;
}
