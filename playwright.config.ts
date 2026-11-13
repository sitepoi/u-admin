import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against a local dev server with PLATFORM_E2E_MODE enabled and a
 * local mock for the Secret API and the CMS system API. No real tenant,
 * Firebase or Secret API is contacted.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node tests/e2e/upstreams.mjs',
      url: 'http://127.0.0.1:4100/health',
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        MOCK_UPSTREAM_PORT: '4100',
        SECRET_API_ADMIN_SERVICE_TOKEN: 'e2e-secret-api-token',
        CMS_SYSTEM_API_KEY: 'e2e-cms-key',
      },
    },
    {
      command: 'npm run dev -- --hostname 127.0.0.1 --port 3000',
      url: 'http://127.0.0.1:3000/login',
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        NODE_ENV: 'development',
        PLATFORM_E2E_MODE: 'true',
        NEXT_PUBLIC_PLATFORM_E2E_MODE: 'true',
        PLATFORM_E2E_SESSION_SECRET: 'e2e-playwright-session-secret',
        PLATFORM_HOST: 'admin.uniconhub.test',
        PLATFORM_ALLOWED_DEV_HOSTS: 'localhost:3000,127.0.0.1:3000',
        PLATFORM_SESSION_TTL_HOURS: '8',
        PLATFORM_REVEAL_FRESH_AUTH_SECONDS: '300',
        PLATFORM_ADMIN_EMAILS:
          'owner@e2e.test,admin@e2e.test,operator@e2e.test,auditor@e2e.test',
        PLATFORM_IP_ALLOWLIST: '',
        PLATFORM_FIREBASE_PROJECT_ID: 'platform-admin-e2e',
        PLATFORM_FIREBASE_CLIENT_EMAIL: 'e2e@platform-admin-e2e.iam.gserviceaccount.com',
        PLATFORM_FIREBASE_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\\nE2E-NOT-A-REAL-KEY\\n-----END PRIVATE KEY-----\\n',
        SECRET_API_BASE_URL: 'http://127.0.0.1:4100',
        SECRET_API_ADMIN_SERVICE_TOKEN: 'e2e-secret-api-token',
        SECRET_API_TIMEOUT_MS: '5000',
        CMS_SYSTEM_API_BASE_URL: 'http://127.0.0.1:4100',
        CMS_SYSTEM_API_KEY: 'e2e-cms-key',
        PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON: JSON.stringify({
          type: 'service_account',
          project_id: 'reporting-e2e',
          client_email: 'reporting@reporting-e2e.iam.gserviceaccount.com',
          private_key: '-----BEGIN PRIVATE KEY-----\\nE2E-REPORTING\\n-----END PRIVATE KEY-----\\n',
        }),
        PLATFORM_REPORTING_CRON_SECRET: 'e2e-cron-secret',
        NEXT_PUBLIC_FIREBASE_API_KEY: 'e2e-public-api-key',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'platform-admin-e2e.firebaseapp.com',
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'platform-admin-e2e',
        NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:e2e',
      },
    },
  ],
});
