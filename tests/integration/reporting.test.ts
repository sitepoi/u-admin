import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GET as refreshReportingCronRoute,
  POST as refreshReportingRoute,
} from '@/app/api/platform/reporting/refresh/route';
import { aggregatePlatformMetrics, getReportingSummary } from '@/lib/server/reporting/collector';
import { InMemoryPlatformStore } from '@/lib/server/firestore/in-memory-store';
import { getPlatformStore, setPlatformStoreForTesting } from '@/lib/server/firestore/store-provider';
import { setTokenVerifierForTesting } from '@/lib/server/auth/token-verifier-provider';
import { buildSnapshotId } from '@/lib/server/firestore/store';
import {
  FakeTokenVerifier,
  buildRequest,
  jsonResponse,
  makeIdentityForRole,
  makeTenant,
  mutationRequest,
  readResponseBody,
  type ApiEnvelope,
} from '@/tests/support/test-helpers';
import type { PlatformReportMetrics, ReportSnapshot } from '@/lib/shared/platform-types';

const SECRET_HEALTH = {
  active: 3,
  pendingDelivery: 1,
  failedDelivery: 2,
  rotationDue: 1,
  retired: 4,
  total: 11,
};

function platformSnapshot(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  const metrics: PlatformReportMetrics = {
    tenantCount: 2,
    tenantsByStatus: { draft: 1, active: 1 },
    totals: {
      objectCount: 120,
      apiRequestsThisMonth: 900,
      firstPartyRequests: 42,
      firstPartyErrors: 3,
      activeUsers30d: 17,
      storageBytes: 4096,
    },
    secretHealth: SECRET_HEALTH,
    collectionFailures: 1,
  };

  return {
    snapshotId: buildSnapshotId(null, '2026-11'),
    tenantId: null,
    period: '2026-11',
    metrics,
    status: 'partial',
    errors: ['tenant-a: objects.count: permission denied'],
    collectedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('oversight reporting', () => {
  let store: InMemoryPlatformStore;
  let verifier: FakeTokenVerifier;
  let ownerSessionCookie: string;

  beforeEach(() => {
    store = new InMemoryPlatformStore();
    setPlatformStoreForTesting(store);
    verifier = new FakeTokenVerifier();
    setTokenVerifierForTesting(verifier);
    ownerSessionCookie = verifier.issueSessionCookie(makeIdentityForRole('owner'));
  });

  it('aggregates tenant metrics into platform totals', () => {
    const tenants = [
      makeTenant({ tenantId: 'a', status: 'active' }),
      makeTenant({ tenantId: 'b', status: 'draft' }),
      makeTenant({ tenantId: 'c', status: 'active' }),
    ];

    const metrics = aggregatePlatformMetrics(
      tenants,
      [
        {
          tenantId: 'a',
          displayName: 'A',
          objectCountTotal: 10,
          objectCountByType: { page: 10 },
          apiRequestsThisMonth: { v1: 5, v2: 5, total: 10 },
          firstParty: { requests: 4, errors: 1 },
          activeUsers30d: 2,
          storageBytes: 100,
          lastError: null,
          collectedAt: '2026-11-01T00:00:00.000Z',
          durationMs: 12,
        },
        {
          tenantId: 'c',
          displayName: 'C',
          objectCountTotal: 5,
          objectCountByType: {},
          apiRequestsThisMonth: null,
          firstParty: null,
          activeUsers30d: 1,
          storageBytes: null,
          lastError: null,
          collectedAt: '2026-11-01T00:00:00.000Z',
          durationMs: 8,
        },
      ],
      SECRET_HEALTH,
      1,
    );

    expect(metrics.tenantCount).toBe(3);
    expect(metrics.tenantsByStatus).toEqual({ active: 2, draft: 1 });
    expect(metrics.totals.objectCount).toBe(15);
    expect(metrics.totals.apiRequestsThisMonth).toBe(10);
    expect(metrics.totals.firstPartyErrors).toBe(1);
    expect(metrics.totals.activeUsers30d).toBe(3);
    expect(metrics.secretHealth).toEqual(SECRET_HEALTH);
    expect(metrics.collectionFailures).toBe(1);
  });

  it('reads cached snapshots only and never fans out to tenant projects', async () => {
    store.seedTenant(makeTenant({ status: 'active' }));
    await store.saveSnapshot(platformSnapshot());

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const summary = await getReportingSummary();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(summary.platformSnapshot?.period).toBe('2026-11');
    expect(summary.secretHealth).toEqual(SECRET_HEALTH);
    expect(summary.tenantCount).toBe(1);
    expect(summary.tenantsByStatus.active).toBe(1);
    expect(summary.lastRefreshAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('stores aggregates without raw tenant objects', async () => {
    store.seedTenant(makeTenant({ status: 'active' }));
    await store.saveSnapshot(platformSnapshot());

    const snapshot = await getPlatformStore().getLatestSnapshot(null);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).toContain('secretHealth');
    expect(serialized).not.toContain('cmsProjectId');
    expect(serialized).not.toContain('displayName');
    expect(serialized).not.toContain('PRIVATE KEY');
  });

  it('refreshes reporting when there are no tenants and records the snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          secrets: [
            { secretId: 'sec_1', tenantId: 'a', status: 'active' },
            { secretId: 'sec_2', tenantId: 'a', status: 'rotation-due' },
          ],
        }),
      ),
    );

    const response = await refreshReportingRoute(
      mutationRequest('/api/platform/reporting/refresh', { sessionCookie: ownerSessionCookie }),
    );

    expect(response.status).toBe(200);
    const payload = await readResponseBody<
      ApiEnvelope<{
        tenantCount: number;
        platformSnapshot: {
          status: string;
          metrics: { secretHealth: { total: number; rotationDue: number } };
        };
      }>
    >(response);

    expect(payload.data?.tenantCount).toBe(0);
    expect(payload.data?.platformSnapshot.metrics.secretHealth.total).toBe(2);
    expect(payload.data?.platformSnapshot.metrics.secretHealth.rotationDue).toBe(1);

    const audit = await store.listAudit({ limit: 10 });
    expect(audit.entries.some((entry) => entry.action === 'reporting.refreshed')).toBe(true);
  });

  it('accepts Vercel Cron with the shared secret and no Origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ secrets: [] })));

    const response = await refreshReportingRoute(
      buildRequest({
        path: '/api/platform/reporting/refresh',
        method: 'POST',
        origin: null,
        headers: { authorization: `Bearer ${process.env.PLATFORM_REPORTING_CRON_SECRET}` },
      }),
    );

    expect(response.status).toBe(200);
  });

  it('rejects an incorrect cron secret and falls back to session auth', async () => {
    const response = await refreshReportingRoute(
      buildRequest({
        path: '/api/platform/reporting/refresh',
        method: 'POST',
        origin: null,
        headers: { authorization: 'Bearer wrong-secret' },
      }),
    );

    // Without a valid cron secret the request is treated as a cookie-session
    // mutation, so the missing Origin is rejected before authentication.
    expect(response.status).toBe(403);
  });

  it('accepts a Vercel Cron GET with the shared secret', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ secrets: [] })));

    const response = await refreshReportingCronRoute(
      buildRequest({
        path: '/api/platform/reporting/refresh',
        method: 'GET',
        origin: null,
        headers: { authorization: `Bearer ${process.env.PLATFORM_REPORTING_CRON_SECRET}` },
      }),
    );

    expect(response.status).toBe(200);
  });

  it('rejects a cron GET without the shared secret', async () => {
    const response = await refreshReportingCronRoute(
      buildRequest({ path: '/api/platform/reporting/refresh', method: 'GET', origin: null }),
    );
    expect(response.status).toBe(401);
  });

  it('requires owner or admin to refresh reporting', async () => {
    const operatorCookie = verifier.issueSessionCookie(makeIdentityForRole('operator'));

    const response = await refreshReportingRoute(
      mutationRequest('/api/platform/reporting/refresh', { sessionCookie: operatorCookie }),
    );

    expect(response.status).toBe(403);
  });
});
