import 'server-only';

import { getPlatformConfig } from '@/lib/server/env';
import { isFreshAuthentication, type PlatformSession } from '@/lib/server/auth/session';
import { assertRoleCan, type Permission } from '@/lib/server/auth/roles';
import { ApiError } from '@/lib/server/errors';

export function requirePermission(session: PlatformSession, permission: Permission): void {
  assertRoleCan(session.role, permission);
}

/**
 * Reveal / retire flows require an interactive authentication that happened
 * within PLATFORM_REVEAL_FRESH_AUTH_SECONDS.
 */
export function assertFreshSessionAuthentication(
  session: PlatformSession,
  nowMs: number = Date.now(),
): void {
  const config = getPlatformConfig();
  if (!isFreshAuthentication(session, config.revealFreshAuthSeconds, nowMs)) {
    throw ApiError.reauthRequired(
      'Please sign in again before continuing. This action requires recent authentication.',
    );
  }
}

/** True when the request presents an owner who authenticated recently. */
export function canRevealWithSession(
  session: PlatformSession,
  nowMs: number = Date.now(),
): boolean {
  if (session.role !== 'owner') return false;
  const config = getPlatformConfig();
  return isFreshAuthentication(session, config.revealFreshAuthSeconds, nowMs);
}
