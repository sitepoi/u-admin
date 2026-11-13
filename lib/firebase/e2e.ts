'use client';

import type { PlatformRole } from '@/lib/shared/constants';

/**
 * Builds a deterministic actor token for local Playwright runs only.
 * The server's E2E verifier understands this grammar and is unreachable in
 * production (see lib/server/env.ts `isE2eMode`).
 */
export function buildE2eActorToken(role: PlatformRole): string {
  const authTime = Math.floor(Date.now() / 1000);
  return `e2e:${role}:${role}@e2e.uniconhub.test:${authTime}`;
}
