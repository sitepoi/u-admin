import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as listSecretMetadataRoute } from '@/app/api/platform/secret-metadata/route';
import { GET as getSecretMetadataRoute } from '@/app/api/platform/secret-metadata/[secretId]/route';
import { InMemoryPlatformStore } from '@/lib/server/firestore/in-memory-store';
import { setPlatformStoreForTesting } from '@/lib/server/firestore/store-provider';
import { setTokenVerifierForTesting } from '@/lib/server/auth/token-verifier-provider';
import {
  FakeTokenVerifier,
  buildRequest,
  jsonResponse,
  makeIdentityForRole,
  readResponseBody,
  type ApiEnvelope,
} from '@/tests/support/test-helpers';

const metadataRouteContext = (secretId: string) => ({
  params: Promise.resolve({ secretId }),
});

describe('Secret API failure handling', () => {
  let verifier: FakeTokenVerifier;
  let ownerSessionCookie: string;

  beforeEach(() => {
    setPlatformStoreForTesting(new InMemoryPlatformStore());
    verifier = new FakeTokenVerifier();
    setTokenVerifierForTesting(verifier);
    ownerSessionCookie = verifier.issueSessionCookie(makeIdentityForRole('owner'));
  });

  it('returns 503 SECRET_API_UNAVAILABLE when the Secret API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('connect ECONNREFUSED'))));

    const response = await listSecretMetadataRoute(
      buildRequest({
        path: '/api/platform/secret-metadata?tenantId=acme-travel',
        sessionCookie: ownerSessionCookie,
      }),
    );

    expect(response.status).toBe(503);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('SECRET_API_UNAVAILABLE');
    expect(JSON.stringify(payload).toLowerCase()).not.toContain('privatekeypem');
  });

  it('returns 503 on an upstream timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
          }),
      ),
    );

    const response = await listSecretMetadataRoute(
      buildRequest({ path: '/api/platform/secret-metadata', sessionCookie: ownerSessionCookie }),
    );

    expect(response.status).toBe(503);
  });

  it('maps an upstream 404 to SECRET_NOT_FOUND', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));

    const response = await getSecretMetadataRoute(
      buildRequest({
        path: '/api/platform/secret-metadata/missing-secret',
        sessionCookie: ownerSessionCookie,
      }),
      metadataRouteContext('missing-secret'),
    );

    expect(response.status).toBe(404);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('SECRET_NOT_FOUND');
  });

  it('rejects an invalid tenantId filter without calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await listSecretMetadataRoute(
      buildRequest({
        path: '/api/platform/secret-metadata?tenantId=..%2Fadmin',
        sessionCookie: ownerSessionCookie,
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires secret metadata permission', async () => {
    const auditorCookie = verifier.issueSessionCookie(makeIdentityForRole('auditor'));

    const response = await listSecretMetadataRoute(
      buildRequest({
        path: '/api/platform/secret-metadata',
        sessionCookie: auditorCookie,
      }),
    );

    expect(response.status).toBe(403);
  });

  it('returns metadata only, never key material', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          secrets: [
            {
              secretId: 'sec_123',
              tenantId: 'acme-travel',
              status: 'active',
              kid: 'kid_1',
              // Even if upstream misbehaves, the client only forwards known fields.
              privateKeyPem: '-----BEGIN PRIVATE KEY-----\nLEAK\n-----END PRIVATE KEY-----',
            },
          ],
        }),
      ),
    );

    const response = await listSecretMetadataRoute(
      buildRequest({ path: '/api/platform/secret-metadata', sessionCookie: ownerSessionCookie }),
    );

    expect(response.status).toBe(200);
    const rawBody = JSON.stringify(await readResponseBody(response));
    expect(rawBody).not.toContain('BEGIN PRIVATE KEY');
  });
});
