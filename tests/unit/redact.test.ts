import { describe, expect, it } from 'vitest';

import { REDACTED, redactText, sanitizeForLog, serializeForLog } from '@/lib/server/logging/redact';

const TEST_PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END PRIVATE KEY-----';
const TEST_JWT =
  'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ';

describe('log redaction', () => {
  it('redacts sensitive object keys', () => {
    const sanitized = sanitizeForLog({
      privateKeyPem: TEST_PRIVATE_KEY,
      idToken: 'token',
      actorIdToken: 'token',
      authorization: 'Bearer abc',
      token: 'abc',
      secret: 'abc',
      password: 'abc',
      apiKey: 'abc',
      serviceAccount: { a: 1 },
      ciphertext: 'abc',
      sessionCookie: 'abc',
    }) as Record<string, unknown>;

    for (const key of Object.keys(sanitized)) {
      expect(sanitized[key]).toBe(REDACTED);
    }
  });

  it('keeps non-sensitive identifiers that merely contain the word secret', () => {
    const sanitized = sanitizeForLog({
      secretId: 'sec_123',
      tenantId: 'acme',
      kid: 'kid_1',
      secretCount: 3,
      secretsReturned: 2,
    }) as Record<string, unknown>;

    expect(sanitized.secretId).toBe('sec_123');
    expect(sanitized.tenantId).toBe('acme');
    expect(sanitized.kid).toBe('kid_1');
    expect(sanitized.secretCount).toBe(3);
    expect(sanitized.secretsReturned).toBe(2);
  });

  it('scrubs PEM blocks and JWTs embedded in strings', () => {
    expect(redactText(`key: ${TEST_PRIVATE_KEY}`)).not.toContain('BEGIN PRIVATE KEY');
    expect(redactText(`token=${TEST_JWT}`)).not.toContain('eyJhbGciOiJSUzI1NiIs');
    expect(redactText('authorization: Bearer abc.def.ghi')).toContain('Bearer [REDACTED]');
  });

  it('scrubs token query parameters', () => {
    expect(redactText('https://x.test/cb?token=abc&state=1')).toBe(
      'https://x.test/cb?token=[REDACTED]&state=1',
    );
  });

  it('does not mutate the input object', () => {
    const input = { idToken: 'abc', nested: { password: 'p' } };
    sanitizeForLog(input);
    expect(input.idToken).toBe('abc');
    expect(input.nested.password).toBe('p');
  });

  it('truncates deep structures instead of recursing forever', () => {
    let deep: Record<string, unknown> = { value: 'end' };
    for (let depth = 0; depth < 20; depth += 1) {
      deep = { child: deep };
    }
    const serialized = serializeForLog(deep);
    expect(serialized).toContain('TRUNCATED');
  });

  it('bounds arrays without dropping the count signal', () => {
    const sanitized = sanitizeForLog(Array.from({ length: 80 }, (_, index) => index)) as unknown[];
    expect(sanitized).toHaveLength(51);
    expect(String(sanitized[50])).toContain('30 more items');
  });

  it('serializes errors without leaking stacks containing tokens', () => {
    const error = new Error(`failed with Bearer ${TEST_JWT}`);
    const serialized = serializeForLog(error);
    expect(serialized).not.toContain('eyJhbGciOiJSUzI1NiIs');
  });
});
