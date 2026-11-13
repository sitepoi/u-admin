import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

import { middleware } from '@/middleware';
import { PLATFORM_CSRF_COOKIE, PLATFORM_SESSION_COOKIE } from '@/lib/shared/constants';
import { TEST_CSRF_TOKEN } from '@/tests/support/test-helpers';

const PLATFORM_HOST_HEADER = { host: 'admin.uniconhub.test' };

function makeMiddlewareRequest(
  path: string,
  options: {
    method?: string;
    host?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  const hostHeader = options.host ?? PLATFORM_HOST_HEADER.host;
  const headers = new Headers({ ...(options.headers ?? {}) });
  headers.set('host', hostHeader);

  const cookieParts = Object.entries(options.cookies ?? {}).map(
    ([name, value]) => `${name}=${value}`,
  );
  if (cookieParts.length > 0) headers.set('cookie', cookieParts.join('; '));

  return new NextRequest(`https://${hostHeader}${path}`, {
    method: options.method ?? 'GET',
    headers,
  });
}

describe('host guard middleware', () => {
  afterEach(() => {
    process.env.PLATFORM_IP_ALLOWLIST = '';
  });

  it('returns 404 for tenant hosts', () => {
    const response = middleware(
      makeMiddlewareRequest('/tenants', { host: 'acme-travel.cms.uniconhub.com' }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('returns 404 for a preview deployment host', () => {
    const response = middleware(
      makeMiddlewareRequest('/tenants', { host: 'u-admin-git-main.vercel.app' }),
    );
    expect(response.status).toBe(404);
  });

  it('serves the configured platform host with strict headers and a nonce CSP', () => {
    const response = middleware(makeMiddlewareRequest('/login'));

    expect(response.status).toBe(200);
    expect(response.headers.get('strict-transport-security')).toContain('max-age=');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('permissions-policy')).toContain('camera=()');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');

    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("object-src 'none'");
  });

  it('redirects unauthenticated platform pages to /login', () => {
    const response = middleware(makeMiddlewareRequest('/tenants'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://admin.uniconhub.test/login?next=%2Ftenants',
    );
  });

  it('redirects a development host to its own http origin', () => {
    const response = middleware(makeMiddlewareRequest('/tenants', { host: 'localhost:3000' }));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login?next=%2Ftenants',
    );
  });

  it('allows the MFA enrolment page without a session', () => {
    const response = middleware(makeMiddlewareRequest('/mfa-enroll'));
    expect(response.status).toBe(200);
  });

  it('allows an authenticated page request through', () => {
    const response = middleware(
      makeMiddlewareRequest('/tenants', {
        cookies: { [PLATFORM_SESSION_COOKIE]: 'session-value' },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('redirects an authenticated user away from /login', () => {
    const response = middleware(
      makeMiddlewareRequest('/login', {
        cookies: { [PLATFORM_SESSION_COOKIE]: 'session-value' },
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://admin.uniconhub.test/');
  });

  it('rejects a cookie-authenticated mutation from a foreign origin', () => {
    const response = middleware(
      makeMiddlewareRequest('/api/platform/tenants', {
        method: 'POST',
        cookies: {
          [PLATFORM_SESSION_COOKIE]: 'session-value',
          [PLATFORM_CSRF_COOKIE]: TEST_CSRF_TOKEN,
        },
        headers: {
          origin: 'https://evil.example.com',
          'x-csrf-token': TEST_CSRF_TOKEN,
        },
      }),
    );
    expect(response.status).toBe(403);
  });

  it('rejects a cookie-authenticated mutation without a CSRF token', () => {
    const response = middleware(
      makeMiddlewareRequest('/api/platform/tenants', {
        method: 'POST',
        cookies: {
          [PLATFORM_SESSION_COOKIE]: 'session-value',
          [PLATFORM_CSRF_COOKIE]: TEST_CSRF_TOKEN,
        },
        headers: { origin: 'https://admin.uniconhub.test' },
      }),
    );
    expect(response.status).toBe(403);
  });

  it('allows a fully validated mutation through', () => {
    const response = middleware(
      makeMiddlewareRequest('/api/platform/tenants', {
        method: 'POST',
        cookies: {
          [PLATFORM_SESSION_COOKIE]: 'session-value',
          [PLATFORM_CSRF_COOKIE]: TEST_CSRF_TOKEN,
        },
        headers: {
          origin: 'https://admin.uniconhub.test',
          'x-csrf-token': TEST_CSRF_TOKEN,
        },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('does not require CSRF for an unauthenticated public mutation', () => {
    const response = middleware(
      makeMiddlewareRequest('/api/auth/session', {
        method: 'POST',
        headers: { origin: 'https://admin.uniconhub.test' },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('enforces the optional IP allowlist', () => {
    process.env.PLATFORM_IP_ALLOWLIST = '203.0.113.0/24';

    const rejected = middleware(
      makeMiddlewareRequest('/login', { headers: { 'x-forwarded-for': '198.51.100.7' } }),
    );
    expect(rejected.status).toBe(404);

    const accepted = middleware(
      makeMiddlewareRequest('/login', { headers: { 'x-forwarded-for': '203.0.113.7' } }),
    );
    expect(accepted.status).toBe(200);
  });

  it('serves robots.txt without allowing indexing', () => {
    const response = middleware(makeMiddlewareRequest('/robots.txt'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });
});
