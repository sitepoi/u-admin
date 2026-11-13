import { NextRequest } from 'next/server';

import type { PlatformRole } from '@/lib/shared/constants';
import type { TenantDetail } from '@/lib/shared/platform-types';
import { PLATFORM_CSRF_COOKIE, PLATFORM_SESSION_COOKIE } from '@/lib/shared/constants';
import type { PlatformTokenVerifier, VerifiedIdentity } from '@/lib/server/auth/token-verifier';
import type { TenantRecord } from '@/lib/server/firestore/store';

export const TEST_ORIGIN = 'https://admin.uniconhub.test';
export const TEST_CSRF_TOKEN = 'test-csrf-token-0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Deterministic verifier. Session cookies are values issued by the fake itself,
 * so tests exercise the real session/cookie/role logic without Firebase.
 */
export class FakeTokenVerifier implements PlatformTokenVerifier {
  private readonly idTokens = new Map<string, VerifiedIdentity>();
  private readonly sessionCookies = new Map<string, VerifiedIdentity>();
  private sessionCounter = 0;

  readonly revokedUids: string[] = [];

  registerIdToken(idToken: string, identity: VerifiedIdentity): void {
    this.idTokens.set(idToken, identity);
  }

  issueSessionCookie(identity: VerifiedIdentity): string {
    this.sessionCounter += 1;
    const cookieValue = `fake-session-cookie-${this.sessionCounter}-${identity.uid}`;
    this.sessionCookies.set(cookieValue, identity);
    return cookieValue;
  }

  async verifyIdToken(idToken: string): Promise<VerifiedIdentity> {
    const identity = this.idTokens.get(idToken);
    if (!identity) throw new Error('Invalid ID token.');
    return identity;
  }

  async verifySessionCookie(sessionCookieValue: string): Promise<VerifiedIdentity> {
    const identity = this.sessionCookies.get(sessionCookieValue);
    if (!identity) throw new Error('Invalid session cookie.');
    return identity;
  }

  async createSessionCookie(idToken: string, _ttlSeconds: number): Promise<string> {
    const identity = await this.verifyIdToken(idToken);
    return this.issueSessionCookie(identity);
  }

  async revokeRefreshTokens(uid: string): Promise<void> {
    this.revokedUids.push(uid);
  }
}

export function makeIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return {
    uid: 'uid-owner',
    email: 'owner@uniconhub.test',
    emailVerified: true,
    platformRole: 'owner',
    secondFactorPresent: true,
    authTime: Math.floor(Date.now() / 1000),
    signInProvider: 'password',
    ...overrides,
  };
}

export function makeIdentityForRole(
  role: PlatformRole,
  overrides: Partial<VerifiedIdentity> = {},
): VerifiedIdentity {
  return makeIdentity({
    uid: `uid-${role}`,
    email: `${role}@uniconhub.test`,
    platformRole: role,
    ...overrides,
  });
}

export function makeTenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  const timestamp = new Date('2026-01-01T00:00:00.000Z').toISOString();
  return {
    tenantId: 'acme-travel',
    displayName: 'Acme Travel',
    status: 'draft',
    cmsProjectId: 'tenant-acme-travel',
    cmsHost: 'acme-travel.cms.uniconhub.com',
    publicwebsiteHost: 'acme-travel.publicwebsite.uniconhub.com',
    publicwebsiteVercelProjectId: 'prj_acme',
    customDomains: [],
    primaryDomain: '',
    deliveryMode: 'manual',
    firstPartyAppId: 'publicwebsite',
    firstPartyStatus: 'not-enrolled',
    provisioning: {
      status: 'idle',
      attemptId: null,
      startedAt: null,
      finishedAt: null,
      lastError: null,
    },
    reporting: { lastRefreshAt: null, lastError: null },
    createdAt: timestamp,
    createdBy: 'uid-owner',
    updatedAt: timestamp,
    ...overrides,
  } satisfies TenantDetail;
}

export interface BuildRequestOptions {
  path: string;
  method?: string;
  body?: unknown;
  sessionCookie?: string;
  csrfToken?: string;
  origin?: string | null;
  headers?: Record<string, string>;
}

export function buildRequest(options: BuildRequestOptions): NextRequest {
  const headers = new Headers(options.headers ?? {});

  const cookieParts: string[] = [];
  if (options.sessionCookie) {
    cookieParts.push(`${PLATFORM_SESSION_COOKIE}=${options.sessionCookie}`);
  }
  if (options.csrfToken) {
    cookieParts.push(`${PLATFORM_CSRF_COOKIE}=${options.csrfToken}`);
  }
  if (cookieParts.length > 0) {
    headers.set('cookie', cookieParts.join('; '));
  }

  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  const origin = options.origin === undefined ? TEST_ORIGIN : options.origin;
  if (origin) headers.set('origin', origin);
  if (options.csrfToken) headers.set('x-csrf-token', options.csrfToken);

  return new NextRequest(`${TEST_ORIGIN}${options.path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

export function mutationRequest(
  path: string,
  options: {
    sessionCookie: string;
    body?: unknown;
    csrfToken?: string;
    method?: string;
    origin?: string | null;
  },
): NextRequest {
  return buildRequest({
    path,
    method: options.method ?? 'POST',
    body: options.body,
    sessionCookie: options.sessionCookie,
    csrfToken: options.csrfToken ?? TEST_CSRF_TOKEN,
    origin: options.origin === undefined ? TEST_ORIGIN : options.origin,
  });
}

export async function readResponseBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
