import 'server-only';

import type { PlatformRole } from '@/lib/shared/constants';
import { ApiError } from '@/lib/server/errors';
import { getPlatformConfig } from '@/lib/server/env';
import { getTokenVerifier } from '@/lib/server/auth/token-verifier-provider';
import type { VerifiedIdentity } from '@/lib/server/auth/token-verifier';
import { isAuthTimeFresh, type PlatformSession } from '@/lib/server/auth/session';

/**
 * Verifies the fresh ID token supplied by the browser for a delegated secret
 * action (reveal / deliver / retire).
 *
 * The Admin server checks the token itself before forwarding it to the Secret
 * API as `actorIdToken`. The Secret API repeats every check independently.
 */
export async function verifyActorIdToken(input: {
  idToken: string;
  session: PlatformSession;
  allowedRoles: readonly PlatformRole[];
  requireFreshAuthentication: boolean;
}): Promise<VerifiedIdentity> {
  const verifier = getTokenVerifier();

  let identity: VerifiedIdentity;
  try {
    identity = await verifier.verifyIdToken(input.idToken);
  } catch {
    throw ApiError.reauthRequired(
      'The re-authentication token is invalid or has expired. Please sign in again.',
    );
  }

  if (identity.uid !== input.session.uid) {
    throw ApiError.forbidden('The re-authentication token does not match the current session.');
  }
  if (!identity.secondFactorPresent) {
    throw ApiError.mfaRequired();
  }
  if (!identity.platformRole || !input.allowedRoles.includes(identity.platformRole)) {
    throw ApiError.forbidden('Your role does not permit this secret action.');
  }

  if (input.requireFreshAuthentication) {
    const config = getPlatformConfig();
    if (!isAuthTimeFresh(identity.authTime, config.revealFreshAuthSeconds)) {
      throw ApiError.reauthRequired(
        'This action requires an authentication within the last few minutes. Please sign in again.',
      );
    }
  }

  return identity;
}
