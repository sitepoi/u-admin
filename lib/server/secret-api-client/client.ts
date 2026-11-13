import 'server-only';

import type { DeliveryMode } from '@/lib/shared/constants';
import type { SecretMetadata } from '@/lib/shared/platform-types';
import { ApiError } from '@/lib/server/errors';
import { getSecretApiConfig } from '@/lib/server/env';
import { logWarn } from '@/lib/server/logging/logger';
import {
  countSecretHealth,
  parseDeliveryResponse,
  parseRevealResponse,
  parseRetireResponse,
  parseSecretListResponse,
  type DeliveryResult,
  type RetireResult,
  type RevealedSecret,
} from '@/lib/server/secret-api-client/types';

export { countSecretHealth };

export type {
  DeliveryResult,
  RetireResult,
  RevealedSecret,
} from '@/lib/server/secret-api-client/types';
export type { SecretMetadata } from '@/lib/shared/platform-types';

const SECRET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const METADATA_CACHE_TTL_MS = 15_000;
const METADATA_CACHE_MAX_ENTRIES = 50;

interface MetadataCacheEntry {
  expiresAt: number;
  secrets: SecretMetadata[];
}

const metadataCache = new Map<string, MetadataCacheEntry>();

export function clearSecretMetadataCache(): void {
  metadataCache.clear();
}

function assertSecretId(secretId: string): string {
  if (!SECRET_ID_PATTERN.test(secretId)) {
    throw ApiError.invalidRequest('Invalid secret id.');
  }
  return secretId;
}

interface SecretApiRequest {
  method: 'GET' | 'POST';
  path: string;
  requestId: string;
  query?: Record<string, string>;
  body?: unknown;
}

async function requestSecretApi(options: SecretApiRequest): Promise<unknown> {
  const config = getSecretApiConfig();
  const url = new URL(`${config.baseUrl}${options.path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers: {
        authorization: `Bearer ${config.adminServiceToken}`,
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-request-id': options.requestId,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (error) {
    logWarn('secret_api.unreachable', {
      path: options.path,
      requestId: options.requestId,
      timedOut: error instanceof Error && error.name === 'AbortError',
    });
    throw new ApiError(
      'SECRET_API_UNAVAILABLE',
      'The Secret API is unavailable. The Admin app cannot decrypt secrets locally.',
      { cause: error },
    );
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (response.status === 404) {
    throw ApiError.notFound('secret');
  }

  if (!response.ok) {
    logWarn('secret_api.request_failed', {
      path: options.path,
      requestId: options.requestId,
      status: response.status,
    });
    throw new ApiError(
      'SECRET_API_UNAVAILABLE',
      'The Secret API could not complete the request.',
      { details: { upstreamStatus: response.status } },
    );
  }

  const responseText = await response.text();
  if (!responseText) return {};
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    logWarn('secret_api.invalid_json', {
      path: options.path,
      requestId: options.requestId,
    });
    throw new ApiError('SECRET_API_UNAVAILABLE', 'The Secret API returned an invalid response.');
  }
}

export interface SecretApiCallContext {
  requestId: string;
}

/**
 * Lists metadata only. `tenantId` is optional; without it the Secret API is
 * expected to return metadata for every tenant (used by /secrets).
 */
export async function listSecretMetadata(
  context: SecretApiCallContext,
  tenantId?: string,
  options: { useCache?: boolean } = {},
): Promise<SecretMetadata[]> {
  const cacheKey = tenantId ?? '__all__';
  const useCache = options.useCache !== false;

  if (useCache) {
    const cached = metadataCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.secrets;
    }
    metadataCache.delete(cacheKey);
  }

  const payload = await requestSecretApi({
    method: 'GET',
    path: '/api/v1/first-party/secrets',
    query: tenantId ? { tenantId } : undefined,
    requestId: context.requestId,
  });

  const secrets = parseSecretListResponse(payload);

  if (useCache) {
    if (metadataCache.size >= METADATA_CACHE_MAX_ENTRIES) {
      const oldestKey = metadataCache.keys().next().value;
      if (oldestKey !== undefined) metadataCache.delete(oldestKey);
    }
    metadataCache.set(cacheKey, {
      expiresAt: Date.now() + METADATA_CACHE_TTL_MS,
      secrets,
    });
  }

  return secrets;
}

export async function getSecretMetadata(
  context: SecretApiCallContext,
  secretIdInput: string,
): Promise<SecretMetadata> {
  const secretId = assertSecretId(secretIdInput);
  const payload = await requestSecretApi({
    method: 'GET',
    path: `/api/v1/first-party/secrets/${encodeURIComponent(secretId)}`,
    requestId: context.requestId,
  });

  const secrets = parseSecretListResponse(payload);
  const match = secrets.find((secret) => secret.secretId === secretId) ?? secrets[0];
  if (!match) {
    throw ApiError.notFound('secret');
  }
  return match;
}

export async function revealSecret(
  context: SecretApiCallContext,
  input: { secretId: string; reason: string; actorIdToken: string },
): Promise<RevealedSecret> {
  const secretId = assertSecretId(input.secretId);
  // Deliberately not logged: request body and response both carry key material.
  const payload = await requestSecretApi({
    method: 'POST',
    path: `/api/v1/first-party/secrets/${encodeURIComponent(secretId)}/reveal`,
    requestId: context.requestId,
    body: {
      reason: input.reason,
      actorIdToken: input.actorIdToken,
      requestId: context.requestId,
    },
  });
  return parseRevealResponse(secretId, payload);
}

export async function deliverSecret(
  context: SecretApiCallContext,
  input: { secretId: string; mode: DeliveryMode; reason: string; actorIdToken: string },
): Promise<DeliveryResult> {
  const secretId = assertSecretId(input.secretId);
  const payload = await requestSecretApi({
    method: 'POST',
    path: `/api/v1/first-party/secrets/${encodeURIComponent(secretId)}/deliver`,
    requestId: context.requestId,
    body: {
      mode: input.mode,
      reason: input.reason,
      actorIdToken: input.actorIdToken,
    },
  });
  clearSecretMetadataCache();
  return parseDeliveryResponse(secretId, payload);
}

export async function retireSecret(
  context: SecretApiCallContext,
  input: { secretId: string; reason: string; actorIdToken: string },
): Promise<RetireResult> {
  const secretId = assertSecretId(input.secretId);
  const payload = await requestSecretApi({
    method: 'POST',
    path: `/api/v1/first-party/secrets/${encodeURIComponent(secretId)}/retire`,
    requestId: context.requestId,
    body: {
      reason: input.reason,
      actorIdToken: input.actorIdToken,
    },
  });
  clearSecretMetadataCache();
  return parseRetireResponse(secretId, payload);
}
