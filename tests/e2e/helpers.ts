import { expect, type Page } from '@playwright/test';

export type E2eRole = 'owner' | 'admin' | 'operator' | 'auditor';

export async function signInAs(page: Page, role: E2eRole): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: `Sign in as ${role}` }).click();
  await expect(page.getByRole('heading', { name: 'Platform dashboard' })).toBeVisible({
    timeout: 30_000,
  });
}

export function uniqueTenantId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

export async function getCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === '__Host-platform_csrf')?.value ?? '';
}
