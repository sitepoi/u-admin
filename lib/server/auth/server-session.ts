import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { PLATFORM_SESSION_COOKIE } from '@/lib/shared/constants';
import {
  getSessionFromCookieValue,
  type PlatformSession,
} from '@/lib/server/auth/session';

/**
 * Server-component session lookup. Uses the Next.js cookie store because server
 * components do not receive a Request object.
 */
export async function getServerSession(): Promise<PlatformSession | null> {
  const cookieStore = await cookies();
  const sessionCookieValue = cookieStore.get(PLATFORM_SESSION_COOKIE)?.value;
  if (!sessionCookieValue) return null;
  try {
    return await getSessionFromCookieValue(sessionCookieValue);
  } catch {
    return null;
  }
}

/** Server components that require an authenticated platform operator. */
export async function requireServerSession(): Promise<PlatformSession> {
  const session = await getServerSession();
  if (!session) redirect('/login');
  return session;
}
