import { beforeEach, describe, expect, it } from 'vitest';

import { createAuditEntry, recordAudit } from '@/lib/server/audit/audit-service';
import { InMemoryPlatformStore } from '@/lib/server/firestore/in-memory-store';
import { setPlatformStoreForTesting } from '@/lib/server/firestore/store-provider';

const AUDIT_CONTEXT = {
  ip: '203.0.113.10',
  userAgent: 'vitest-agent',
  requestId: 'req-12345678',
};

describe('audit records', () => {
  let store: InMemoryPlatformStore;

  beforeEach(() => {
    store = new InMemoryPlatformStore();
    setPlatformStoreForTesting(store);
  });

  it('builds a complete append-only record', () => {
    const entry = createAuditEntry({
      actor: { uid: 'uid-owner', email: 'owner@uniconhub.test', role: 'owner' },
      action: 'tenant.created',
      targetType: 'tenant',
      targetId: 'acme-travel',
      tenantId: 'acme-travel',
      result: 'success',
      metadata: { displayName: 'Acme' },
      context: AUDIT_CONTEXT,
    });

    expect(entry.auditId).toMatch(/[0-9a-f-]{36}/);
    expect(entry.tenantId).toBe('acme-travel');
    expect(entry.result).toBe('success');
    expect(entry.ip).toBe('203.0.113.10');
    expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.metadata).toEqual({ displayName: 'Acme' });
  });

  it('redacts token-shaped metadata before persisting it', async () => {
    await recordAudit({
      actor: { uid: 'uid-owner', email: 'owner@uniconhub.test', role: 'owner' },
      action: 'secret.deliver_requested',
      targetType: 'secret',
      targetId: 'sec_1',
      result: 'success',
      metadata: {
        mode: 'manual',
        idToken: 'super-secret-token',
        actorIdToken: 'super-secret-token',
        authorization: 'Bearer abc',
        nested: { password: 'hunter2' },
      },
      context: AUDIT_CONTEXT,
    });

    const page = await store.listAudit({ limit: 10 });
    const [entry] = page.entries;
    expect(entry?.metadata).toEqual({
      mode: 'manual',
      idToken: '[REDACTED]',
      actorIdToken: '[REDACTED]',
      authorization: '[REDACTED]',
      nested: { password: '[REDACTED]' },
    });
  });

  it('is append-only: duplicate ids are rejected and there is no delete API', async () => {
    expect('deleteAudit' in store).toBe(false);
    expect('updateAudit' in store).toBe(false);

    const entry = createAuditEntry({
      auditId: 'fixed-audit-id',
      actor: { uid: 'uid-owner', email: 'owner@uniconhub.test', role: 'owner' },
      action: 'tenant.updated',
      targetType: 'tenant',
      targetId: 'acme-travel',
      result: 'success',
      context: AUDIT_CONTEXT,
    });

    await store.appendAudit(entry);
    await expect(store.appendAudit(entry)).rejects.toThrow(/already exists/);
  });

  it('returns newest first with stable cursor pagination', async () => {
    for (let index = 0; index < 5; index += 1) {
      await store.appendAudit(
        createAuditEntry({
          actor: { uid: 'uid-owner', email: 'owner@uniconhub.test', role: 'owner' },
          action: 'tenant.updated',
          targetType: 'tenant',
          targetId: `tenant-${index}`,
          tenantId: `tenant-${index}`,
          result: 'success',
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
          context: AUDIT_CONTEXT,
        }),
      );
    }

    const firstPage = await store.listAudit({ limit: 2 });
    expect(firstPage.entries.map((entry) => entry.targetId)).toEqual(['tenant-4', 'tenant-3']);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await store.listAudit({ limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.entries.map((entry) => entry.targetId)).toEqual(['tenant-2', 'tenant-1']);
  });

  it('filters by tenant, action, result and date range', async () => {
    await store.appendAudit(
      createAuditEntry({
        actor: { uid: 'uid-owner', email: 'owner@uniconhub.test', role: 'owner' },
        action: 'tenant.created',
        targetType: 'tenant',
        targetId: 'acme',
        tenantId: 'acme',
        result: 'success',
        createdAt: '2026-02-01T10:00:00.000Z',
        context: AUDIT_CONTEXT,
      }),
    );
    await store.appendAudit(
      createAuditEntry({
        actor: { uid: 'uid-admin', email: 'admin@uniconhub.test', role: 'admin' },
        action: 'auth.denied',
        targetType: 'platform',
        targetId: 'route',
        result: 'denied',
        createdAt: '2026-03-01T10:00:00.000Z',
        context: AUDIT_CONTEXT,
      }),
    );

    expect((await store.listAudit({ tenantId: 'acme', limit: 10 })).entries).toHaveLength(1);
    expect((await store.listAudit({ action: 'auth.denied', limit: 10 })).entries).toHaveLength(1);
    expect((await store.listAudit({ result: 'denied', limit: 10 })).entries).toHaveLength(1);
    expect(
      (await store.listAudit({ from: '2026-02-15T00:00:00.000Z', limit: 10 })).entries,
    ).toHaveLength(1);
  });
});
