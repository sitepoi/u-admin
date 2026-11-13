import { beforeEach, describe, expect, it } from 'vitest';

import { POST as createSession } from '@/app/api/auth/session/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { InMemoryPlatformStore } from '@/lib/server/firestore/in-memory-store';
import { getPlatformStore, setPlatformStoreForTesting } from '@/lib/server/firestore/store-provider';
import { setTokenVerifierForTesting } from '@/lib/server/auth/token-verifier-provider';
import {
  FakeTokenVerifier,
  TEST_CSRF_TOKEN,
  buildRequest,
  makeIdentity,
  mutationRequest,
  readResponseBody,
  type ApiEnvelope,
} from '@/tests/support/test-helpers';

interface SessionPayload {
  role: string;
  email: string;
  expiresInSeconds: number;
}

describe('session lifecycle', () => {
  let store: InMemoryPlatformStore;
  let verifier: FakeTokenVerifier;

  beforeEach(() => {
    store = new InMemoryPlatformStore();
    setPlatformStoreForTesting(store);
    verifier = new FakeTokenVerifier();
    setTokenVerifierForTesting(verifier);
  });

  it('creates an 8 hour __Host- session and a double-submit CSRF cookie', async () => {
    verifier.registerIdToken('test-id-token-owner-00000001', makeIdentity());

    const response = await createSession(
      buildRequest({
        path: '/api/auth/session',
        method: 'POST',
        body: { idToken: 'test-id-token-owner-00000001' },
      }),
    );

    expect(response.status).toBe(200);
    const payload = await readResponseBody<ApiEnvelope<SessionPayload>>(response);
    expect(payload.ok).toBe(true);
    expect(payload.data?.role).toBe('owner');
    expect(payload.data?.expiresInSeconds).toBe(8 * 60 * 60);

    const setCookieHeaders = response.headers.getSetCookie();
    const sessionCookie = setCookieHeaders.find((cookie) =>
      cookie.startsWith('__Host-platform_session='),
    );
    const csrfCookie = setCookieHeaders.find((cookie) =>
      cookie.startsWith('__Host-platform_csrf='),
    );

    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.toLowerCase()).toContain('httponly');
    expect(sessionCookie?.toLowerCase()).toContain('secure');
    expect(sessionCookie?.toLowerCase()).toContain('samesite=lax');
    expect(sessionCookie).toContain('Path=/');
    expect(sessionCookie).toContain('Max-Age=28800');

    expect(csrfCookie).toBeDefined();
    expect(csrfCookie?.toLowerCase()).not.toContain('httponly');

    const audit = await store.listAudit({ limit: 10 });
    expect(audit.entries.some((entry) => entry.action === 'auth.session_created')).toBe(true);
  });

  it('rejects an email that is not on the platform allowlist', async () => {
    verifier.registerIdToken(
      'test-id-token-stranger-00001',
      makeIdentity({ uid: 'uid-stranger', email: 'stranger@example.com' }),
    );

    const response = await createSession(
      buildRequest({
        path: '/api/auth/session',
        method: 'POST',
        body: { idToken: 'test-id-token-stranger-00001' },
      }),
    );

    expect(response.status).toBe(401);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('UNAUTHORIZED');
    expect(response.headers.getSetCookie()).toHaveLength(0);

    const audit = await store.listAudit({ limit: 10 });
    expect(audit.entries.some((entry) => entry.action === 'auth.denied')).toBe(true);
  });

  it('rejects a token without a second factor and audits auth.mfa_missing', async () => {
    verifier.registerIdToken(
      'test-id-token-no-mfa-0000001',
      makeIdentity({ secondFactorPresent: false }),
    );

    const response = await createSession(
      buildRequest({
        path: '/api/auth/session',
        method: 'POST',
        body: { idToken: 'test-id-token-no-mfa-0000001' },
      }),
    );

    expect(response.status).toBe(403);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('MFA_REQUIRED');

    const audit = await store.listAudit({ limit: 10 });
    expect(audit.entries.some((entry) => entry.action === 'auth.mfa_missing')).toBe(true);
  });

  it('rejects a token without a platform role', async () => {
    verifier.registerIdToken('test-id-token-no-role-000001', makeIdentity({ platformRole: null }));

    const response = await createSession(
      buildRequest({
        path: '/api/auth/session',
        method: 'POST',
        body: { idToken: 'test-id-token-no-role-000001' },
      }),
    );

    expect(response.status).toBe(403);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('FORBIDDEN');
  });

  it('rejects the local E2E actor when E2E mode is disabled', async () => {
    const response = await createSession(
      buildRequest({
        path: '/api/auth/session',
        method: 'POST',
        body: { e2eActor: 'owner' },
      }),
    );

    expect(response.status).toBe(400);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('INVALID_REQUEST');
  });

  it('requires the platform origin for session creation', async () => {
    verifier.registerIdToken('test-id-token-owner-00000001', makeIdentity());

    const response = await createSession(
      buildRequest({
        path: '/api/auth/session',
        method: 'POST',
        body: { idToken: 'test-id-token-owner-00000001' },
        origin: 'https://evil.example.com',
      }),
    );

    expect(response.status).toBe(403);
  });

  it('rejects session creation without an Origin header', async () => {
    verifier.registerIdToken('test-id-token-owner-00000001', makeIdentity());

    const response = await createSession(
      buildRequest({
        path: '/api/auth/session',
        method: 'POST',
        body: { idToken: 'test-id-token-owner-00000001' },
        origin: null,
      }),
    );

    expect(response.status).toBe(403);
  });

  it('logs out by clearing cookies and revoking refresh tokens', async () => {
    const identity = makeIdentity();
    const sessionCookie = verifier.issueSessionCookie(identity);

    const response = await logout(
      mutationRequest('/api/auth/logout', {
        sessionCookie,
        csrfToken: TEST_CSRF_TOKEN,
      }),
    );

    expect(response.status).toBe(200);
    expect(verifier.revokedUids).toContain(identity.uid);

    const clearedCookies = response.headers.getSetCookie();
    expect(clearedCookies.some((cookie) => cookie.startsWith('__Host-platform_session=;'))).toBe(
      true,
    );
    expect(clearedCookies.some((cookie) => cookie.includes('Max-Age=0'))).toBe(true);

    const audit = await store.listAudit({ limit: 10 });
    expect(audit.entries.some((entry) => entry.action === 'auth.logout')).toBe(true);
  });

  it('rejects logout mutations without a CSRF token', async () => {
    const sessionCookie = verifier.issueSessionCookie(makeIdentity());

    const noCsrfResponse = await logout(
      buildRequest({
        path: '/api/auth/logout',
        method: 'POST',
        sessionCookie,
      }),
    );
    expect(noCsrfResponse.status).toBe(403);
  });
});
