import { describe, expect, it, vi } from 'vitest';

import {
  clearSecretMetadataCache,
  deliverSecret,
  getSecretMetadata,
  listSecretMetadata,
  retireSecret,
  revealSecret,
} from '@/lib/server/secret-api-client/client';
import { ApiError } from '@/lib/server/errors';
import { jsonResponse } from '@/tests/support/test-helpers';

const CONTEXT = { requestId: 'req-secret-1' };

function stubFetch() {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const RAW_SECRET = {
  secretId: 'sec_123',
  tenantId: 'acme-travel',
  appId: 'publicwebsite',
  kid: 'kid_2026_01',
  algorithm: 'RS256',
  status: 'ACTIVE',
  deliveryMode: 'runtime-fetch',
  deliveryStatus: 'delivered',
  fingerprint: 'SHA256:abc',
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  rotationDueAt: '2026-08-01T00:00:00.000Z',
  lastDeliveredAt: '2026-02-01T00:00:00.000Z',
  lastDeliveryError: null,
};

describe('Secret API client', () => {
  it('accepts every documented list envelope shape', async () => {
    const fetchMock = stubFetch();

    fetchMock.mockResolvedValueOnce(jsonResponse({ secrets: [RAW_SECRET] }));
    const fromObject = await listSecretMetadata(CONTEXT, 'acme-travel', { useCache: false });
    expect(fromObject).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(jsonResponse([RAW_SECRET]));
    const fromArray = await listSecretMetadata(CONTEXT, 'acme-travel', { useCache: false });
    expect(fromArray).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [RAW_SECRET] }));
    const fromData = await listSecretMetadata(CONTEXT, 'acme-travel', { useCache: false });
    expect(fromData).toHaveLength(1);

    clearSecretMetadataCache();
  });

  it('normalizes metadata without key material', async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue(jsonResponse({ secrets: [RAW_SECRET] }));

    const [secret] = await listSecretMetadata(CONTEXT, undefined, { useCache: false });
    expect(secret?.status).toBe('active');
    expect(secret?.deliveryMode).toBe('runtime-fetch');
    expect(secret?.kid).toBe('kid_2026_01');
    expect(JSON.stringify(secret)).not.toContain('PRIVATE KEY');
  });

  it('sends the service token only in the Authorization header', async () => {
    const fetchMock = stubFetch();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ secrets: [] })));

    await listSecretMetadata(CONTEXT, 'acme-travel', { useCache: false });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(requestUrl)).toContain('/api/v1/first-party/secrets');
    expect(String(requestUrl)).toContain('tenantId=acme-travel');
    const headers = requestInit.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Bearer ${process.env.SECRET_API_ADMIN_SERVICE_TOKEN}`,
    );
    expect(headers['x-request-id']).toBe('req-secret-1');
    expect(requestInit.cache).toBe('no-store');
  });

  it('fetches a single secret by id', async () => {
    const fetchMock = stubFetch();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(RAW_SECRET)));

    const secret = await getSecretMetadata(CONTEXT, 'sec_123');
    expect(secret.secretId).toBe('sec_123');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/first-party/secrets/sec_123');
  });

  it('maps upstream 404 to SECRET_NOT_FOUND', async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));

    await expect(getSecretMetadata(CONTEXT, 'missing')).rejects.toMatchObject({
      code: 'SECRET_NOT_FOUND',
    });
  });

  it('maps a network failure to SECRET_API_UNAVAILABLE without leaking the token', async () => {
    const fetchMock = stubFetch();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    try {
      await listSecretMetadata(CONTEXT, undefined, { useCache: false });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.code).toBe('SECRET_API_UNAVAILABLE');
      expect(apiError.message).not.toContain('test-service-token-do-not-log');
      expect(JSON.stringify(apiError.details ?? {})).not.toContain(
        'test-service-token-do-not-log',
      );
    }
  });

  it('times out according to SECRET_API_TIMEOUT_MS', async () => {
    const fetchMock = stubFetch();
    fetchMock.mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    );

    const startedAt = Date.now();
    await expect(
      listSecretMetadata(CONTEXT, undefined, { useCache: false }),
    ).rejects.toMatchObject({ code: 'SECRET_API_UNAVAILABLE' });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(500);
  });

  it('rejects a malformed upstream payload', async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }));

    await expect(
      listSecretMetadata(CONTEXT, undefined, { useCache: false }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('forwards actorIdToken and requestId on reveal, without logging them', async () => {
    const fetchMock = stubFetch();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          secretId: 'sec_123',
          kid: 'kid_2026_01',
          algorithm: 'RS256',
          version: 3,
          privateKeyPem: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----',
        }),
      ),
    );

    const revealed = await revealSecret(CONTEXT, {
      secretId: 'sec_123',
      reason: 'Rotation investigation',
      actorIdToken: 'actor-id-token-value',
    });

    expect(revealed.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(revealed.kid).toBe('kid_2026_01');

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(requestUrl)).toContain('/api/v1/first-party/secrets/sec_123/reveal');
    expect(requestInit.method).toBe('POST');
    const body = JSON.parse(String(requestInit.body)) as Record<string, string>;
    expect(body.actorIdToken).toBe('actor-id-token-value');
    expect(body.reason).toBe('Rotation investigation');
    expect(body.requestId).toBe('req-secret-1');
  });

  it('rejects a reveal response without key material', async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue(jsonResponse({ secretId: 'sec_123' }));

    await expect(
      revealSecret(CONTEXT, {
        secretId: 'sec_123',
        reason: 'Rotation investigation',
        actorIdToken: 'actor-id-token-value',
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('posts delivery and retirement requests in the documented shape', async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse({ secretId: 'sec_123', mode: 'manual', deliveryStatus: 'delivered' }),
        ),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse({ secretId: 'sec_123', status: 'retired', retiredAt: null })),
      );

    const delivery = await deliverSecret(CONTEXT, {
      secretId: 'sec_123',
      mode: 'manual',
      reason: 'Manual delivery to tenant',
      actorIdToken: 'actor-token',
    });
    expect(delivery.deliveryStatus).toBe('delivered');

    const retirement = await retireSecret(CONTEXT, {
      secretId: 'sec_123',
      reason: 'Key rotation complete',
      actorIdToken: 'actor-token',
    });
    expect(retirement.status).toBe('retired');

    const deliveryBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, string>;
    expect(deliveryBody.mode).toBe('manual');
    expect(deliveryBody.actorIdToken).toBe('actor-token');

    const retireBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    ) as Record<string, string>;
    expect(retireBody.reason).toBe('Key rotation complete');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/retire');
  });

  it('rejects unsafe secret ids before calling upstream', async () => {
    const fetchMock = stubFetch();
    await expect(
      revealSecret(CONTEXT, {
        secretId: '../admin',
        reason: 'bad id test',
        actorIdToken: 'actor-token',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches metadata briefly and bypasses the cache on request', async () => {
    const fetchMock = stubFetch();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ secrets: [RAW_SECRET] })));

    await listSecretMetadata(CONTEXT, 'acme-travel');
    await listSecretMetadata(CONTEXT, 'acme-travel');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await listSecretMetadata(CONTEXT, 'acme-travel', { useCache: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
