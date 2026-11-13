import { afterEach, beforeEach, vi } from 'vitest';

import { resetServerEnvCacheForTesting } from '@/lib/server/env';
import { setPlatformStoreForTesting } from '@/lib/server/firestore/store-provider';
import { setTokenVerifierForTesting } from '@/lib/server/auth/token-verifier-provider';
import { clearSecretMetadataCache } from '@/lib/server/secret-api-client/client';
import { resetRateLimitsForTesting } from '@/lib/server/rate-limit/limiter';

const reportingServiceAccount = JSON.stringify({
  type: 'service_account',
  project_id: 'reporting-test-project',
  client_email: 'reporting-reader@reporting-test-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nTEST-REPORTING-KEY\\n-----END PRIVATE KEY-----\\n',
});

process.env.PLATFORM_HOST = 'admin.uniconhub.test';
process.env.PLATFORM_ALLOWED_DEV_HOSTS = 'localhost:3000,127.0.0.1:3000';
process.env.PLATFORM_SESSION_TTL_HOURS = '8';
process.env.PLATFORM_REVEAL_FRESH_AUTH_SECONDS = '300';
process.env.PLATFORM_ADMIN_EMAILS =
  'owner@uniconhub.test,admin@uniconhub.test,operator@uniconhub.test,auditor@uniconhub.test';
process.env.PLATFORM_IP_ALLOWLIST = '';

process.env.PLATFORM_FIREBASE_PROJECT_ID = 'platform-admin-test';
process.env.PLATFORM_FIREBASE_CLIENT_EMAIL = 'admin@platform-admin-test.iam.gserviceaccount.com';
process.env.PLATFORM_FIREBASE_PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\\nTEST-ADMIN-KEY\\n-----END PRIVATE KEY-----\\n';

process.env.SECRET_API_BASE_URL = 'https://secret-api.uniconhub.test';
process.env.SECRET_API_ADMIN_SERVICE_TOKEN = 'test-service-token-do-not-log';
process.env.SECRET_API_TIMEOUT_MS = '700';

process.env.CMS_SYSTEM_API_BASE_URL = 'https://cms.uniconhub.test';
process.env.CMS_SYSTEM_API_KEY = 'test-cms-key-do-not-log';
process.env.CMS_SYSTEM_API_TIMEOUT_MS = '3000';

process.env.PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON = reportingServiceAccount;
process.env.PLATFORM_REPORTING_MAX_CONCURRENCY = '3';
process.env.PLATFORM_REPORTING_CRON_SECRET = 'test-cron-secret-value';
process.env.PLATFORM_REPORTING_TENANT_TIMEOUT_MS = '1000';

delete process.env.PLATFORM_E2E_MODE;
delete process.env.NEXT_PUBLIC_PLATFORM_E2E_MODE;

beforeEach(() => {
  resetServerEnvCacheForTesting();
  setPlatformStoreForTesting(null);
  setTokenVerifierForTesting(null);
  clearSecretMetadataCache();
  resetRateLimitsForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
