import { expect, test } from '@playwright/test';

import { getCsrfToken, signInAs, uniqueTenantId } from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Platform Admin end to end', () => {
  test('presents a private login with no signup and establishes an MFA session', async ({
    page,
  }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Platform Admin' })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign up|signup|create account/i })).toHaveCount(0);
    await expect(page.getByText(/no public sign-up/i)).toBeVisible();

    await signInAs(page, 'owner');

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name === '__Host-platform_session');
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.secure).toBe(true);

    const csrfCookie = cookies.find((cookie) => cookie.name === '__Host-platform_csrf');
    expect(csrfCookie).toBeTruthy();
    expect(csrfCookie?.httpOnly).toBe(false);
  });

  test('creates a tenant and provisions it against the mocked CMS', async ({ page }) => {
    await signInAs(page, 'owner');

    await page.getByRole('link', { name: 'Tenants' }).first().click();
    await page.getByRole('button', { name: 'New tenant' }).click();

    const tenantId = uniqueTenantId('acme-travel');
    const tenantDisplayName = 'Acme Travel E2E';

    await page.getByLabel('Tenant id').fill(tenantId);
    await page.getByLabel('Display name').fill(tenantDisplayName);
    await page.getByRole('button', { name: 'Create tenant' }).click();

    await expect(page).toHaveURL(new RegExp(`/tenants/${tenantId}$`));
    await expect(page.getByRole('heading', { name: tenantDisplayName })).toBeVisible();
    await expect(page.locator('header').getByText('draft', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Provision tenant' }).click();
    await page.getByRole('button', { name: 'Start provisioning' }).click();

    await expect(page.getByText('Provisioning completed. Tenant is active.')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('header').getByText('active', { exact: true })).toBeVisible();
  });

  test('shows secret metadata and reveals the key only through the Secret API', async ({
    page,
  }) => {
    await signInAs(page, 'owner');

    await page.goto('/secrets');
    await expect(page.getByRole('heading', { name: 'First-party secrets' })).toBeVisible();

    const globalSecretRow = page.getByRole('row').filter({ hasText: 'sec_e2e_global' });
    await expect(globalSecretRow).toBeVisible();
    await globalSecretRow.getByRole('link', { name: 'Open' }).click();

    await expect(page.getByRole('heading', { name: 'sec_e2e_global' })).toBeVisible();

    await page.getByRole('button', { name: 'Reveal private key' }).click();
    await page.getByLabel('Reason').fill('E2E rotation investigation');
    await page.getByRole('button', { name: 'Continue with local E2E identity' }).click();

    const revealedKey = page.getByTestId('revealed-secret');
    await expect(revealedKey).toBeVisible({ timeout: 30_000 });
    await expect(revealedKey).toContainText('E2E-TEST-KEY-NOT-REAL');

    await page.getByRole('button', { name: 'Close and clear' }).click();
    await expect(page.getByTestId('revealed-secret')).toHaveCount(0);

    // Reloading must not resurrect the key: it was never persisted.
    await page.reload();
    await expect(page.getByTestId('revealed-secret')).toHaveCount(0);
  });

  test('denies reveal to a non-owner, both in the UI and at the API', async ({ page }) => {
    await signInAs(page, 'admin');

    await page.goto('/secrets/sec_e2e_global');
    await expect(page.getByRole('heading', { name: 'sec_e2e_global' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reveal private key' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Deliver secret' })).toBeVisible();

    const csrfToken = await getCsrfToken(page);
    const response = await page.request.post('/api/platform/secrets/sec_e2e_global/reveal', {
      headers: {
        origin: 'http://localhost:3000',
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      data: {
        reason: 'E2E non-owner denial attempt',
        idToken: 'e2e:admin:admin@e2e.test:1700000000',
      },
    });

    expect(response.status()).toBe(403);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe('FORBIDDEN');
  });

  test('writes audit entries for the sensitive actions above', async ({ page }) => {
    await signInAs(page, 'owner');

    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();

    await expect(page.getByRole('cell', { name: 'tenant.created', exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'secret.reveal_requested', exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'tenant.provision_succeeded', exact: true }).first(),
    ).toBeVisible();
  });

  test('refuses non-platform hosts', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3000/tenants', {
      headers: { host: 'tenant.example.com' },
    });
    expect(response.status()).toBe(404);
  });
});
