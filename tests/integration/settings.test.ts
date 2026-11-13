import { beforeEach, describe, expect, it } from 'vitest';

import {
  GET as getSettingsRoute,
  PATCH as patchSettingsRoute,
} from '@/app/api/platform/settings/route';
import { InMemoryPlatformStore } from '@/lib/server/firestore/in-memory-store';
import { getPlatformStore, setPlatformStoreForTesting } from '@/lib/server/firestore/store-provider';
import { setTokenVerifierForTesting } from '@/lib/server/auth/token-verifier-provider';
import { getPlatformSettings } from '@/lib/server/settings/settings-service';
import {
  FakeTokenVerifier,
  buildRequest,
  makeIdentityForRole,
  mutationRequest,
  readResponseBody,
  type ApiEnvelope,
} from '@/tests/support/test-helpers';

describe('platform settings', () => {
  let store: InMemoryPlatformStore;
  let verifier: FakeTokenVerifier;
  let ownerSessionCookie: string;
  let adminSessionCookie: string;
  let operatorSessionCookie: string;

  beforeEach(() => {
    store = new InMemoryPlatformStore();
    setPlatformStoreForTesting(store);
    verifier = new FakeTokenVerifier();
    setTokenVerifierForTesting(verifier);
    ownerSessionCookie = verifier.issueSessionCookie(makeIdentityForRole('owner'));
    adminSessionCookie = verifier.issueSessionCookie(makeIdentityForRole('admin'));
    operatorSessionCookie = verifier.issueSessionCookie(makeIdentityForRole('operator'));
  });

  it('returns defaults to any reader', async () => {
    const response = await getSettingsRoute(
      buildRequest({ path: '/api/platform/settings', sessionCookie: operatorSessionCookie }),
    );

    expect(response.status).toBe(200);
    const payload = await readResponseBody<
      ApiEnvelope<{ settings: { reportingAutoRefreshEnabled: boolean } }>
    >(response);
    expect(payload.data?.settings.reportingAutoRefreshEnabled).toBe(false);
  });

  it('requires the owner role to change settings', async () => {
    const response = await patchSettingsRoute(
      mutationRequest('/api/platform/settings', {
        sessionCookie: adminSessionCookie,
        method: 'PATCH',
        body: { reportingAutoRefreshEnabled: true },
      }),
    );

    expect(response.status).toBe(403);
    expect((await getPlatformSettings()).reportingAutoRefreshEnabled).toBe(false);
  });

  it('persists owner changes and audits the update', async () => {
    const response = await patchSettingsRoute(
      mutationRequest('/api/platform/settings', {
        sessionCookie: ownerSessionCookie,
        method: 'PATCH',
        body: {
          reportingAutoRefreshEnabled: true,
          defaultDeliveryMode: 'runtime-fetch',
          maintenanceNotice: 'Scheduled maintenance at 02:00 UTC.',
        },
      }),
    );

    expect(response.status).toBe(200);
    const settings = await getPlatformSettings();
    expect(settings.reportingAutoRefreshEnabled).toBe(true);
    expect(settings.defaultDeliveryMode).toBe('runtime-fetch');
    expect(settings.maintenanceNotice).toContain('Scheduled maintenance');

    const storedSetting = await getPlatformStore().getSetting('defaultDeliveryMode');
    expect(storedSetting?.updatedBy).toBe('uid-owner');

    const audit = await store.listAudit({ limit: 10 });
    expect(audit.entries.some((entry) => entry.action === 'settings.updated')).toBe(true);
  });

  it('rejects an empty settings patch', async () => {
    const response = await patchSettingsRoute(
      mutationRequest('/api/platform/settings', {
        sessionCookie: ownerSessionCookie,
        method: 'PATCH',
        body: {},
      }),
    );

    expect(response.status).toBe(400);
  });
});
