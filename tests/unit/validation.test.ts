import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/server/errors';
import {
  auditQuerySchema,
  createTenantRequestSchema,
  parseJsonBody,
  sessionRequestSchema,
  settingsUpdateRequestSchema,
  updateTenantRequestSchema,
} from '@/lib/server/validation/schemas';

function jsonRequest(body: string, contentType = 'application/json'): Request {
  return new Request('https://admin.uniconhub.test/api/x', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

describe('request schemas', () => {
  it('accepts a minimal tenant create request', () => {
    const result = createTenantRequestSchema.safeParse({
      tenantId: 'acme-travel',
      displayName: 'Acme Travel',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown fields', () => {
    const result = createTenantRequestSchema.safeParse({
      tenantId: 'acme-travel',
      displayName: 'Acme Travel',
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a one-character display name', () => {
    const result = createTenantRequestSchema.safeParse({
      tenantId: 'acme-travel',
      displayName: 'A',
    });
    expect(result.success).toBe(false);
  });

  it('allows archive status only through the known enum', () => {
    expect(updateTenantRequestSchema.safeParse({ status: 'archived' }).success).toBe(true);
    expect(updateTenantRequestSchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });

  it('requires an id token or an e2e actor for sessions', () => {
    expect(sessionRequestSchema.safeParse({}).success).toBe(false);
    expect(sessionRequestSchema.safeParse({ idToken: 'x'.repeat(30) }).success).toBe(true);
    expect(sessionRequestSchema.safeParse({ e2eActor: 'owner' }).success).toBe(true);
  });

  it('coerces and bounds audit pagination', () => {
    const parsed = auditQuerySchema.safeParse({ limit: '25' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(25);

    expect(auditQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ result: 'maybe' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: 'not-a-date' }).success).toBe(false);
  });

  it('validates settings payloads', () => {
    expect(settingsUpdateRequestSchema.safeParse({ maintenanceNotice: 'hi' }).success).toBe(true);
    expect(
      settingsUpdateRequestSchema.safeParse({ defaultDeliveryMode: 'sneaky' }).success,
    ).toBe(false);
    expect(
      settingsUpdateRequestSchema.safeParse({ unexpected: true }).success,
    ).toBe(false);
  });
});

describe('parseJsonBody', () => {
  it('parses valid JSON', async () => {
    const parsed = await parseJsonBody(
      jsonRequest(JSON.stringify({ tenantId: 'acme', displayName: 'Acme' })),
      createTenantRequestSchema,
    );
    expect(parsed.tenantId).toBe('acme');
  });

  it('rejects a non-JSON content type', async () => {
    await expect(
      parseJsonBody(jsonRequest('{}', 'text/plain'), createTenantRequestSchema),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('rejects invalid JSON without echoing the body', async () => {
    const bodyWithSecret = '{"idToken": "super-secret-token",';
    try {
      await parseJsonBody(jsonRequest(bodyWithSecret), sessionRequestSchema);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).not.toContain('super-secret-token');
      expect(JSON.stringify((error as ApiError).details ?? {})).not.toContain(
        'super-secret-token',
      );
    }
  });

  it('rejects bodies over the size limit', async () => {
    const oversized = JSON.stringify({ displayName: 'x'.repeat(70 * 1024), tenantId: 'acme' });
    await expect(
      parseJsonBody(jsonRequest(oversized), createTenantRequestSchema),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('rejects an empty body', async () => {
    await expect(parseJsonBody(jsonRequest(''), createTenantRequestSchema)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});
