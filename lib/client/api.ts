'use client';

import { PLATFORM_CSRF_COOKIE } from '@/lib/shared/constants';

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiClientError';
    this.code = payload.code;
    this.status = status;
    this.details = payload.details;
  }
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const cookie of document.cookie.split(';')) {
    const [name, ...valueParts] = cookie.trim().split('=');
    if (name === PLATFORM_CSRF_COOKIE) {
      return decodeURIComponent(valueParts.join('='));
    }
  }
  return null;
}

interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Browser-side fetch wrapper for the Platform Admin API.
 * The CSRF token is echoed from the double-submit cookie; it is never stored.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const csrfToken = readCsrfCookie();
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (error) {
    throw new ApiClientError(0, {
      code: 'NETWORK_ERROR',
      message: 'The server could not be reached. Check your connection and try again.',
      details: error instanceof Error ? error.message : undefined,
    });
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const parsedPayload = payload as
    | { ok: true; data: T }
    | { ok: false; error: ApiErrorPayload }
    | null;

  if (!response.ok || !parsedPayload || parsedPayload.ok === false) {
    const errorPayload: ApiErrorPayload =
      parsedPayload && parsedPayload.ok === false
        ? parsedPayload.error
        : { code: 'INTERNAL_ERROR', message: 'The request failed.' };
    throw new ApiClientError(response.status, errorPayload);
  }

  return parsedPayload.data;
}
