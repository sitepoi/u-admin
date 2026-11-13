import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as listTenantsRoute, POST as createTenantRoute } from '@/app/api/platform/tenants/route';
import { PATCH as patchTenantRoute } from '@/app/api/platform/tenants/[tenantId]/route';
import { POST as provisionTenantRoute } from '@/app/api/platform/tenants/[tenantId]/provision/route';
import { InMemoryPlatformStore } from '@/lib/server/firestore/in-memory-store';
import { setPlatformStoreForTesting } from '@/lib/server/firestore/store-provider';
import { setTokenVerifierForTesting } from '@/lib/server/auth/token-verifier-provider';
import {
  FakeTokenVerifier,
  TEST_CSRF_TOKEN,
  buildRequest,
  jsonResponse,
  makeIdentityForRole,
  makeTenant,
  mutationRequest,
  readResponseBody,
  type ApiEnvelope,
} from '@/tests/support/test-helpers';

const tenantRouteContext = (tenantId: string) => ({
  params: Promise.resolve({ tenantId }),
});

interface TenantPayload {
  tenant: {
    tenantId: string;
    status: string;
    cmsHost: string;
    cmsProjectId: string;
    provisioning: { status: string; attemptId: string | null; lastError: string | null };
    reporting: { lastRefreshAt: string | null; lastError: string | null };
  };
}

describe('tenant management and provisioning', () => {
  let store: InMemoryPlatformStore;
  let verifier: FakeTokenVerifier;
  let ownerSessionCookie: string;
  let operatorSessionCookie: string;
  let adminSessionCookie: string;

  beforeEach(() => {
    store = new InMemoryPlatformStore();
    setPlatformStoreForTesting(store);
    verifier = new FakeTokenVerifier();
    setTokenVerifierForTesting(verifier);
    ownerSessionCookie = verifier.issueSessionCookie(makeIdentityForRole('owner'));
    adminSessionCookie = verifier.issueSessionCookie(makeIdentityForRole('admin'));
    operatorSessionCookie = verifier.issueSessionCookie(makeIdentityForRole('operator'));
  });

  function createTenantRequest(
    body: Record<string, unknown>,
    sessionCookie = ownerSessionCookie,
  ) {
    return mutationRequest('/api/platform/tenants', { sessionCookie, body });
  }

  it('creates a draft tenant with a normalized id and generated hosts', async () => {
    const response = await createTenantRoute(
      createTenantRequest({ tenantId: 'Acme-Travel', displayName: 'Acme Travel' }),
    );

    expect(response.status).toBe(201);
    const payload = await readResponseBody<ApiEnvelope<TenantPayload>>(response);
    expect(payload.data?.tenant.tenantId).toBe('acme-travel');
    expect(payload.data?.tenant.status).toBe('draft');
    expect(payload.data?.tenant.cmsHost).toBe('acme-travel.cms.uniconhub.com');
    expect(payload.data?.tenant.cmsProjectId).toBe('tenant-acme-travel');

    const storedTenant = await store.getTenant('acme-travel');
    expect(storedTenant?.status).toBe('draft');

    const audit = await store.listAudit({ limit: 10 });
    expect(audit.entries.some((entry) => entry.action === 'tenant.created')).toBe(true);
  });

  it('rejects duplicates case-insensitively', async () => {
    await createTenantRoute(
      createTenantRequest({ tenantId: 'acme-travel', displayName: 'Acme Travel' }),
    );

    const response = await createTenantRoute(
      createTenantRequest({ tenantId: 'ACME-Travel', displayName: 'Acme Again' }),
    );

    expect(response.status).toBe(409);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('TENANT_CONFLICT');
  });

  it('rejects reserved tenant ids', async () => {
    const response = await createTenantRoute(
      createTenantRequest({ tenantId: 'admin', displayName: 'Reserved Id' }),
    );

    expect(response.status).toBe(409);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('TENANT_RESERVED');
  });

  it('requires tenant:write to create metadata', async () => {
    const auditorCookie = verifier.issueSessionCookie(makeIdentityForRole('auditor'));
    const response = await createTenantRoute(
      createTenantRequest({ tenantId: 'acme-travel', displayName: 'Acme Travel' }, auditorCookie),
    );

    expect(response.status).toBe(403);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('FORBIDDEN');
  });

  it('lists and searches tenants', async () => {
    await createTenantRoute(
      createTenantRequest({ tenantId: 'acme-travel', displayName: 'Acme Travel' }),
    );
    await createTenantRoute(
      createTenantRequest({ tenantId: 'globex', displayName: 'Globex Corporation' }),
    );

    const response = await listTenantsRoute(
      buildRequest({ path: '/api/platform/tenants?search=acme', sessionCookie: ownerSessionCookie }),
    );

    expect(response.status).toBe(200);
    const payload = await readResponseBody<
      ApiEnvelope<{ tenants: Array<{ tenantId: string }> }>
    >(response);
    expect(payload.data?.tenants.map((tenant) => tenant.tenantId)).toEqual(['acme-travel']);
  });

  it('updates tenant metadata and records an audit entry', async () => {
    store.seedTenant(makeTenant());

    const response = await patchTenantRoute(
      mutationRequest('/api/platform/tenants/acme-travel', {
        sessionCookie: operatorSessionCookie,
        method: 'PATCH',
        body: {
          displayName: 'Acme Travel Group',
          primaryDomain: 'www.acme-travel.com',
          customDomains: ['acme-travel.com'],
        },
      }),
      tenantRouteContext('acme-travel'),
    );

    expect(response.status).toBe(200);
    const updated = await store.getTenant('acme-travel');
    expect(updated?.displayName).toBe('Acme Travel Group');
    expect(updated?.primaryDomain).toBe('www.acme-travel.com');
    expect(updated?.customDomains).toEqual(['acme-travel.com']);

    const audit = await store.listAudit({ limit: 10 });
    expect(audit.entries.some((entry) => entry.action === 'tenant.updated')).toBe(true);
  });

  it('rejects an invalid domain on update', async () => {
    store.seedTenant(makeTenant());

    const response = await patchTenantRoute(
      mutationRequest('/api/platform/tenants/acme-travel', {
        sessionCookie: ownerSessionCookie,
        method: 'PATCH',
        body: { cmsHost: 'not a host' },
      }),
      tenantRouteContext('acme-travel'),
    );

    expect(response.status).toBe(400);
  });

  it('archives a tenant instead of deleting it, and requires the owner role', async () => {
    store.seedTenant(makeTenant());

    const adminResponse = await patchTenantRoute(
      mutationRequest('/api/platform/tenants/acme-travel', {
        sessionCookie: adminSessionCookie,
        method: 'PATCH',
        body: { status: 'archived', reason: 'Tenant left the platform' },
      }),
      tenantRouteContext('acme-travel'),
    );
    expect(adminResponse.status).toBe(403);

    const ownerResponse = await patchTenantRoute(
      mutationRequest('/api/platform/tenants/acme-travel', {
        sessionCookie: ownerSessionCookie,
        method: 'PATCH',
        body: { status: 'archived', reason: 'Tenant left the platform' },
      }),
      tenantRouteContext('acme-travel'),
    );
    expect(ownerResponse.status).toBe(200);

    expect((await store.getTenant('acme-travel'))?.status).toBe('archived');
    const audit = await store.listAudit({ limit: 10 });
    expect(audit.entries.some((entry) => entry.action === 'tenant.archived')).toBe(true);
  });

  it('provisions through the CMS system API and marks the tenant active', async () => {
    store.seedTenant(makeTenant());
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({}, 201));
    vi.stubGlobal('fetch', fetchMock);

    const response = await provisionTenantRoute(
      mutationRequest('/api/platform/tenants/acme-travel/provision', {
        sessionCookie: ownerSessionCookie,
      }),
      tenantRouteContext('acme-travel'),
    );

    expect(response.status).toBe(200);
    const payload = await readResponseBody<
      ApiEnvelope<{ outcome: string; tenant: TenantPayload['tenant']; attemptId: string }>
    >(response);
    expect(payload.data?.outcome).toBe('succeeded');
    expect(payload.data?.tenant.status).toBe('active');

    const cmsUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(cmsUrl).toContain('/api/system/test-cms-key-do-not-log/ctgc/acme-travel/tenant-acme-travel');

    const audit = await store.listAudit({ limit: 20 });
    expect(audit.entries.some((entry) => entry.action === 'tenant.provision_started')).toBe(true);
    expect(audit.entries.some((entry) => entry.action === 'tenant.provision_succeeded')).toBe(true);
    expect((await store.getTenant('acme-travel'))?.provisioning.status).toBe('succeeded');
  });

  it('records a provisioning failure and allows a retry', async () => {
    store.seedTenant(makeTenant());

    const failingFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: 'cms exploded' }, 500),
    );
    vi.stubGlobal('fetch', failingFetch);

    const failedResponse = await provisionTenantRoute(
      mutationRequest('/api/platform/tenants/acme-travel/provision', {
        sessionCookie: ownerSessionCookie,
      }),
      tenantRouteContext('acme-travel'),
    );

    expect(failedResponse.status).toBe(200);
    const failedPayload = await readResponseBody<
      ApiEnvelope<{ outcome: string; lastError: string | null }>
    >(failedResponse);
    expect(failedPayload.data?.outcome).toBe('failed');
    expect(failedPayload.data?.lastError).toContain('HTTP 500');

    const failedTenant = await store.getTenant('acme-travel');
    expect(failedTenant?.status).toBe('failed');
    expect(failedTenant?.provisioning.lastError).toContain('HTTP 500');

    const audit = await store.listAudit({ limit: 20 });
    expect(audit.entries.some((entry) => entry.action === 'tenant.provision_failed')).toBe(true);

    const succeedingFetch = vi.fn<typeof fetch>(async () => jsonResponse({}, 200));
    vi.stubGlobal('fetch', succeedingFetch);

    const retriedResponse = await provisionTenantRoute(
      mutationRequest('/api/platform/tenants/acme-travel/provision', {
        sessionCookie: ownerSessionCookie,
      }),
      tenantRouteContext('acme-travel'),
    );
    const retriedPayload = await readResponseBody<ApiEnvelope<{ outcome: string }>>(retriedResponse);
    expect(retriedPayload.data?.outcome).toBe('succeeded');
    expect((await store.getTenant('acme-travel'))?.status).toBe('active');
  });

  it('retries first-party enrollment when the CMS reports a conflict', async () => {
    store.seedTenant(makeTenant());
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'exists' }, 409))
      .mockResolvedValueOnce(jsonResponse({}, 200));
    vi.stubGlobal('fetch', fetchMock);

    const response = await provisionTenantRoute(
      mutationRequest('/api/platform/tenants/acme-travel/provision', {
        sessionCookie: ownerSessionCookie,
      }),
      tenantRouteContext('acme-travel'),
    );

    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/rfti/acme-travel/tenant-acme-travel');
  });

  it('prevents concurrent provisioning attempts', async () => {
    store.seedTenant(makeTenant());

    let releaseCms: (() => void) | undefined;
    let signalCmsStarted: (() => void) | undefined;
    const cmsStarted = new Promise<void>((resolve) => {
      signalCmsStarted = resolve;
    });

    const concurrencyFetchMock = vi.fn<typeof fetch>(() => {
      signalCmsStarted?.();
      return new Promise<Response>((resolve) => {
        releaseCms = () => resolve(jsonResponse({}, 201));
      });
    });
    vi.stubGlobal('fetch', concurrencyFetchMock);

    const firstRequest = provisionTenantRoute(
      mutationRequest('/api/platform/tenants/acme-travel/provision', {
        sessionCookie: ownerSessionCookie,
      }),
      tenantRouteContext('acme-travel'),
    );

    await cmsStarted;

    const secondResponse = await provisionTenantRoute(
      mutationRequest('/api/platform/tenants/acme-travel/provision', {
        sessionCookie: ownerSessionCookie,
      }),
      tenantRouteContext('acme-travel'),
    );

    expect(secondResponse.status).toBe(409);
    const secondPayload = await readResponseBody<ApiEnvelope<never>>(secondResponse);
    expect(secondPayload.error?.code).toBe('PROVISIONING_IN_PROGRESS');

    releaseCms?.();
    const firstResponse = await firstRequest;
    expect(firstResponse.status).toBe(200);
  });

  it('refuses to provision an archived tenant', async () => {
    store.seedTenant(makeTenant({ status: 'archived' }));

    const response = await provisionTenantRoute(
      mutationRequest('/api/platform/tenants/acme-travel/provision', {
        sessionCookie: ownerSessionCookie,
      }),
      tenantRouteContext('acme-travel'),
    );

    expect(response.status).toBe(400);
  });

  it('requires owner or admin to provision', async () => {
    store.seedTenant(makeTenant());

    const response = await provisionTenantRoute(
      mutationRequest('/api/platform/tenants/acme-travel/provision', {
        sessionCookie: operatorSessionCookie,
      }),
      tenantRouteContext('acme-travel'),
    );

    expect(response.status).toBe(403);
    const payload = await readResponseBody<ApiEnvelope<never>>(response);
    expect(payload.error?.code).toBe('FORBIDDEN');
  });

  it('rejects a provisioning mutation without a CSRF token', async () => {
    store.seedTenant(makeTenant());

    const response = await provisionTenantRoute(
      buildRequest({
        path: '/api/platform/tenants/acme-travel/provision',
        method: 'POST',
        sessionCookie: ownerSessionCookie,
      }),
      tenantRouteContext('acme-travel'),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('x-csrf-token')).toBeNull();
    expect(TEST_CSRF_TOKEN.length).toBeGreaterThan(32);
  });
});
