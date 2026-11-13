import 'server-only';

import { NextResponse } from 'next/server';

import type { ApiError, ApiErrorCode } from '@/lib/server/errors';

export const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
};

export function jsonOk(
  data: unknown,
  options: { status?: number; headers?: Record<string, string>; requestId?: string } = {},
): NextResponse {
  const headers: Record<string, string> = {
    ...NO_STORE_HEADERS,
    ...(options.headers ?? {}),
  };
  if (options.requestId) headers['X-Request-Id'] = options.requestId;

  return NextResponse.json({ ok: true, data }, { status: options.status ?? 200, headers });
}

export interface ApiErrorBody {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export function jsonError(error: ApiError, requestId?: string): NextResponse {
  const body: ApiErrorBody = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };

  const headers: Record<string, string> = {
    ...NO_STORE_HEADERS,
    ...error.headers,
  };
  if (requestId) headers['X-Request-Id'] = requestId;

  return NextResponse.json(body, { status: error.status, headers });
}
