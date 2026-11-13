import 'server-only';

import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Honours an inbound request id when it is well-formed, otherwise generates a
 * new one. The value is echoed in the `X-Request-Id` response header and in
 * every structured log line for the request.
 */
export function getRequestId(request: Request): string {
  const inboundRequestId = request.headers.get('x-request-id');
  if (inboundRequestId && REQUEST_ID_PATTERN.test(inboundRequestId)) {
    return inboundRequestId;
  }
  return randomUUID();
}

/**
 * Best-effort client address. The authoritative client identity comes from the
 * access proxy in front of the app; this value is used for rate limiting and
 * audit context only.
 */
export function getClientIp(request: Request): string {
  const candidates = [
    request.headers.get('cf-connecting-ip'),
    request.headers.get('true-client-ip'),
    request.headers.get('x-real-ip'),
    request.headers.get('x-forwarded-for')?.split(',')[0],
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
  return 'unknown';
}

export function getUserAgent(request: Request): string {
  return (request.headers.get('user-agent') ?? '').slice(0, 512);
}

/** Request path without the query string (query strings can contain tokens). */
export function getSafePath(request: Request): string {
  try {
    return new URL(request.url).pathname.slice(0, 200);
  } catch {
    return '/';
  }
}
