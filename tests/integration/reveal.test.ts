import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as revealSecretRoute } from '@/app/api/platform/secrets/[secretId]/reveal/route';
import { InMemoryPlatformStore } from '@/lib/server/firestore/in-memory-store';
import { setPlatformStoreForTesting } from '@/lib/server/firestore/store-provider';
import { setTokenVerifierForTesting } from '@/lib/server/auth/token-verifier-provider';
import {
  FakeTokenVerifier,
  buildRequest,
  jsonResponse,
  makeIdentity,
  makeIdentityForRole,
  mutationRequest,
  readResponseBody,
  type ApiEnvelope,
} from '@/tests/support/test-helpers';

const SECRET_ID = 'sec_123';
const ACTOR_TOKEN = 'test-actor-id-token-owner-0001';
const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nREVEALED-IN-TEST\n-----END PRIVATE KEY-----';

const routeContext = () => ({ params: Promise.resolve({ secretId: SECRET_ID }) });

describe('owner reveal proxy', () => {
  let store: InMemoryPlatformStore;
  let verifier: FakeTokenVerifier;
  let ownerSessionCookie: string;

  beforeEach(() => {
    store = new InMemoryPlatformStore();
    setPlatformStoreForTesting(store);
    verifier = new FakeTokenVerifier();
    setTokenVerifierForTesting(verifier);
    ownerSessionCookie = verifier.issueSessionCookie(makeIdentityForRole('owner'));
    verifier.registerIdToken(ACTOR_TOKEN, makeIdentity());
  });

  function revealRequest(
    options: {
      sessionCookie?: string;
      idToken?: string;
      reason?: string;
      csrfToken?: string | null;
    } = {},
  ) {
    const path = `/api/platform/secrets/${SECRET_ID}/reveal`;
    if (options.csrfToken === null) {
      return buildRequest({
        path,
        method: 'POST',
        sessionCookie: options.sessionCookie ?? ownerSessionCookie,
        body: { reason: options.reason ?? 'Investigate tenant incident', idToken: options.idToken ?? ACTOR_TOKEN },
      });
    }
    return mutationRequest(path, {
      sessionCookie: options.sessionCookie ?? ownerSessionCookie,
      body: { reason: options.reason ?? 'Investigate tenant incident', idToken: options.idToken ?? ACTOR_TOKEN },
    });
  }

  it('returns the key with no-store and forwards the actor token', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        secretId: SECRET_ID,
        kid: 'kid_2026_01',
        privateKeyPem: PRIVATE_KEY,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await revealSecretRoute(revealRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');

    const payload = await readResponseBody<
      ApiEnvelope<{ secret: { privateKeyPem: string; kid: string | null } }>
    >(response);
    expect(payload.data?.secret.privateKeyPem).toBe(PRIVATE_KEY);

    const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(upstreamUrl)).toContain(`/api/v1/first-party/secrets/${SECRET_ID}/reveal`);
    expect(upstreamInit.method).toBe('POST');
    const upstreamBody = JSON.parse(String(upstreamInit.body)) as Record<string, string>;
    expect(upstreamBody.actorIdToken).toBe(ACTOR_TOKEN);
    expect(upstreamBody.reason).toBe('Investigate tenant incident');
    expect(upstreamBody.requestId).toBeTruthy();
  });

  it('records secret.reveal_requested in the audit log', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ secretId: SECRET_ID, privateKeyPem: PRIVATE_KEY })),
    );

    await revealSecretRoute(revealRequest(), routeContext());

    const audit = await store.listAudit({ limit: 20 });
    expect(audit.entries.some((entry) => entry.action === 'secret.reveal_requested')).toBe(true);
  });

  it('denies non-owner roles and writes secret.reveal_denied', async () => {
    const adminCookie = verifier.issueSessionCookie(makeIdentityForRole('admin'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await revealSecretRoute(
      revealRequest({ sessionCookie: adminCookie }),
      routeContext(),
    );

    expect(response.status).toBe(403);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('FORBIDDEN');
    expect(fetchMock).not.toHaveBeenCalled();

    const audit = await store.listAudit({ limit: 20 });
    expect(audit.entries.some((entry) => entry.action === 'secret.reveal_denied')).toBe(true);
  });

  it('requires a fresh authentication on the actor token', async () => {
    verifier.registerIdToken(
      'test-actor-id-token-stale-00001',
      makeIdentity({ authTime: Math.floor(Date.now() / 1000) - 600 }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await revealSecretRoute(
      revealRequest({ idToken: 'test-actor-id-token-stale-00001' }),
      routeContext(),
    );

    expect(response.status).toBe(403);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('REAUTH_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();

    const audit = await store.listAudit({ limit: 20 });
    expect(audit.entries.some((entry) => entry.action === 'secret.reveal_denied')).toBe(true);
  });

  it('rejects an actor token belonging to another user', async () => {
    verifier.registerIdToken(
      'test-actor-id-token-other-0001',
      makeIdentity({ uid: 'uid-someone-else' }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await revealSecretRoute(
      revealRequest({ idToken: 'test-actor-id-token-other-0001' }),
      routeContext(),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an actor token without MFA', async () => {
    verifier.registerIdToken(
      'test-actor-id-token-no-mfa-001',
      makeIdentity({ secondFactorPresent: false }),
    );

    const response = await revealSecretRoute(
      revealRequest({ idToken: 'test-actor-id-token-no-mfa-001' }),
      routeContext(),
    );

    expect(response.status).toBe(403);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('MFA_REQUIRED');
  });

  it('requires a CSRF token for the reveal mutation', async () => {
    const response = await revealSecretRoute(revealRequest({ csrfToken: null }), routeContext());
    expect(response.status).toBe(403);
  });

  it('returns 503 when the Secret API fails and never falls back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'vault down' }, 500)));

    const response = await revealSecretRoute(revealRequest(), routeContext());

    expect(response.status).toBe(503);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('SECRET_API_UNAVAILABLE');
    expect(JSON.stringify(payload)).not.toContain('PRIVATE KEY');

    const audit = await store.listAudit({ limit: 20 });
    expect(
      audit.entries.some(
        (entry) => entry.action === 'secret.reveal_denied' && entry.result === 'error',
      ),
    ).toBe(true);
  });

  it('never logs the private key, actor token or service token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ secretId: SECRET_ID, privateKeyPem: PRIVATE_KEY })),
    );

    const capturedLines: string[] = [];
    const capture = (...args: unknown[]) => {
      capturedLines.push(args.map((value) => String(value)).join(' '));
    };
    vi.spyOn(console, 'info').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);

    const response = await revealSecretRoute(revealRequest(), routeContext());
    expect(response.status).toBe(200);

    const combinedLogs = capturedLines.join('\n');
    expect(combinedLogs).not.toContain('REVEALED-IN-TEST');
    expect(combinedLogs).not.toContain(ACTOR_TOKEN);
    expect(combinedLogs).not.toContain('test-service-token-do-not-log');
  });
});
