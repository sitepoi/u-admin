import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as deliverRoute } from '@/app/api/platform/secrets/[secretId]/deliver/route';
import { POST as retireRoute } from '@/app/api/platform/secrets/[secretId]/retire/route';
import { InMemoryPlatformStore } from '@/lib/server/firestore/in-memory-store';
import { setPlatformStoreForTesting } from '@/lib/server/firestore/store-provider';
import { setTokenVerifierForTesting } from '@/lib/server/auth/token-verifier-provider';
import {
  FakeTokenVerifier,
  jsonResponse,
  makeIdentity,
  makeIdentityForRole,
  mutationRequest,
  readResponseBody,
  type ApiEnvelope,
} from '@/tests/support/test-helpers';

const SECRET_ID = 'sec_deliver';
const OWNER_ACTOR_TOKEN = 'test-actor-id-token-owner-deliver';
const ADMIN_ACTOR_TOKEN = 'test-actor-id-token-admin-deliver';
const routeContext = () => ({ params: Promise.resolve({ secretId: SECRET_ID }) });

describe('secret delivery and retirement proxies', () => {
  let store: InMemoryPlatformStore;
  let verifier: FakeTokenVerifier;
  let ownerSessionCookie: string;
  let adminSessionCookie: string;

  beforeEach(() => {
    store = new InMemoryPlatformStore();
    setPlatformStoreForTesting(store);
    verifier = new FakeTokenVerifier();
    setTokenVerifierForTesting(verifier);
    ownerSessionCookie = verifier.issueSessionCookie(makeIdentityForRole('owner'));
    adminSessionCookie = verifier.issueSessionCookie(makeIdentityForRole('admin'));
    verifier.registerIdToken(OWNER_ACTOR_TOKEN, makeIdentity({ uid: 'uid-owner' }));
    verifier.registerIdToken(
      ADMIN_ACTOR_TOKEN,
      makeIdentity({ uid: 'uid-admin', email: 'admin@uniconhub.test', platformRole: 'admin' }),
    );
  });

  it('delivers as admin and forwards the actor token and mode', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        secretId: SECRET_ID,
        mode: 'runtime-fetch',
        deliveryStatus: 'delivered',
        deliveredAt: '2026-01-01T00:00:00.000Z',
        target: 'runtime',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await deliverRoute(
      mutationRequest(`/api/platform/secrets/${SECRET_ID}/deliver`, {
        sessionCookie: adminSessionCookie,
        body: {
          mode: 'runtime-fetch',
          reason: 'Deliver the rotated key to runtime',
          idToken: ADMIN_ACTOR_TOKEN,
        },
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    const payload = await readResponseBody<ApiEnvelope<{ delivery: { deliveryStatus: string } }>>(
      response,
    );
    expect(payload.data?.delivery.deliveryStatus).toBe('delivered');

    const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(String(upstreamUrl)).toContain(`/api/v1/first-party/secrets/${SECRET_ID}/deliver`);
    const upstreamBody = JSON.parse(String(upstreamInit.body)) as Record<string, string>;
    expect(upstreamBody.mode).toBe('runtime-fetch');
    expect(upstreamBody.actorIdToken).toBe(ADMIN_ACTOR_TOKEN);

    const audit = await store.listAudit({ limit: 10 });
    expect(audit.entries.some((entry) => entry.action === 'secret.deliver_requested')).toBe(true);
  });

  it('rejects delivery by an operator', async () => {
    const operatorCookie = verifier.issueSessionCookie(makeIdentityForRole('operator'));

    const response = await deliverRoute(
      mutationRequest(`/api/platform/secrets/${SECRET_ID}/deliver`, {
        sessionCookie: operatorCookie,
        body: {
          mode: 'manual',
          reason: 'Operator should not deliver keys',
          idToken: OWNER_ACTOR_TOKEN,
        },
      }),
      routeContext(),
    );

    expect(response.status).toBe(403);
  });

  it('retires as owner', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ secretId: SECRET_ID, status: 'retired', retiredAt: null }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await retireRoute(
      mutationRequest(`/api/platform/secrets/${SECRET_ID}/retire`, {
        sessionCookie: ownerSessionCookie,
        body: { reason: 'Rotation completed for this tenant', idToken: OWNER_ACTOR_TOKEN },
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/api/v1/first-party/secrets/${SECRET_ID}/retire`,
    );

    const audit = await store.listAudit({ limit: 10 });
    expect(audit.entries.some((entry) => entry.action === 'secret.retire_requested')).toBe(true);
  });

  it('denies retirement to an admin even with a valid actor token', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await retireRoute(
      mutationRequest(`/api/platform/secrets/${SECRET_ID}/retire`, {
        sessionCookie: adminSessionCookie,
        body: { reason: 'Admin should not retire keys', idToken: ADMIN_ACTOR_TOKEN },
      }),
      routeContext(),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
