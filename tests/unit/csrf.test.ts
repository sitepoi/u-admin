import { describe, expect, it } from 'vitest';

import { isCsrfTokenValid, readCookie, timingSafeEqualString } from '@/lib/edge/cookies';
import { assertCsrfToken, assertOriginAllowed, hasSessionCookie } from '@/lib/server/auth/csrf';
import { ApiError } from '@/lib/server/errors';
import { TEST_CSRF_TOKEN, TEST_ORIGIN, buildRequest } from '@/tests/support/test-helpers';

const ACCEPTED_ORIGINS = [TEST_ORIGIN, 'http://localhost:3000'];

describe('CSRF double submit', () => {
  it('accepts matching long tokens', () => {
    expect(isCsrfTokenValid(TEST_CSRF_TOKEN, TEST_CSRF_TOKEN)).toBe(true);
  });

  it('rejects mismatched, missing or short tokens', () => {
    expect(isCsrfTokenValid(TEST_CSRF_TOKEN, `${TEST_CSRF_TOKEN}x`)).toBe(false);
    expect(isCsrfTokenValid(null, TEST_CSRF_TOKEN)).toBe(false);
    expect(isCsrfTokenValid(TEST_CSRF_TOKEN, null)).toBe(false);
    expect(isCsrfTokenValid('short', 'short')).toBe(false);
  });

  it('compares in constant time without throwing on length mismatch', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
    expect(timingSafeEqualString('abc', 'abcd')).toBe(false);
  });

  it('passes when header and cookie match', () => {
    const request = buildRequest({
      path: '/api/platform/tenants',
      method: 'POST',
      sessionCookie: 'session',
      csrfToken: TEST_CSRF_TOKEN,
      body: {},
    });
    expect(() => assertCsrfToken(request)).not.toThrow();
  });

  it('fails when the header is missing', () => {
    const request = buildRequest({
      path: '/api/platform/tenants',
      method: 'POST',
      sessionCookie: 'session',
      csrfToken: TEST_CSRF_TOKEN,
      body: {},
    });
    request.headers.delete('x-csrf-token');
    expect(() => assertCsrfToken(request)).toThrow(ApiError);
  });

  it('fails when the cookie is missing', () => {
    const request = buildRequest({
      path: '/api/platform/tenants',
      method: 'POST',
      sessionCookie: 'session',
      csrfToken: TEST_CSRF_TOKEN,
      body: {},
    });
    request.headers.set('cookie', '__Host-platform_session=session');
    expect(() => assertCsrfToken(request)).toThrow(ApiError);
  });
});

describe('origin checks', () => {
  it('accepts the platform origin', () => {
    const request = buildRequest({ path: '/api/x', method: 'POST', body: {} });
    expect(() => assertOriginAllowed(request, ACCEPTED_ORIGINS)).not.toThrow();
  });

  it('accepts a configured development origin', () => {
    const request = buildRequest({
      path: '/api/x',
      method: 'POST',
      body: {},
      origin: 'http://localhost:3000',
    });
    expect(() => assertOriginAllowed(request, ACCEPTED_ORIGINS)).not.toThrow();
  });

  it('rejects a missing Origin header', () => {
    const request = buildRequest({ path: '/api/x', method: 'POST', body: {}, origin: null });
    expect(() => assertOriginAllowed(request, ACCEPTED_ORIGINS)).toThrow(/Origin/);
  });

  it('rejects a foreign Origin', () => {
    const request = buildRequest({
      path: '/api/x',
      method: 'POST',
      body: {},
      origin: 'https://evil.example.com',
    });
    expect(() => assertOriginAllowed(request, ACCEPTED_ORIGINS)).toThrow(ApiError);
  });

  it('rejects a cross-site Sec-Fetch-Site even with a matching Origin', () => {
    const request = buildRequest({
      path: '/api/x',
      method: 'POST',
      body: {},
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(() => assertOriginAllowed(request, ACCEPTED_ORIGINS)).toThrow(ApiError);
  });

  it('normalizes a trailing slash in the configured origin', () => {
    const request = buildRequest({ path: '/api/x', method: 'POST', body: {} });
    expect(() => assertOriginAllowed(request, [`${TEST_ORIGIN}/`])).not.toThrow();
  });
});

describe('cookie helpers', () => {
  it('parses a cookie header', () => {
    expect(readCookie('a=1; __Host-platform_session=abc; b=2', '__Host-platform_session')).toBe(
      'abc',
    );
    expect(readCookie(null, 'a')).toBeNull();
  });

  it('detects a session cookie', () => {
    const withSession = buildRequest({ path: '/', sessionCookie: 'abc' });
    const withoutSession = buildRequest({ path: '/' });
    expect(hasSessionCookie(withSession)).toBe(true);
    expect(hasSessionCookie(withoutSession)).toBe(false);
  });
});
