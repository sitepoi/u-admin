import 'server-only';

import { getEdgePlatformConfig, getAcceptedOrigins } from '@/lib/edge/platform-config';
import { ConfigurationError } from '@/lib/server/errors';

/** Re-exported so callers only import from the server env module. */
export { ConfigurationError };

export interface PlatformServerConfig {
  platformHost: string;
  allowedDevHosts: string[];
  acceptedOrigins: string[];
  adminEmails: string[];
  sessionTtlSeconds: number;
  revealFreshAuthSeconds: number;
  ipAllowlist: string[];
  isDevelopment: boolean;
  e2eMode: boolean;
}

export interface AdminFirebaseConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface SecretApiConfig {
  baseUrl: string;
  adminServiceToken: string;
  timeoutMs: number;
}

export interface CmsConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  cmsHostSuffix: string;
  publicwebsiteHostSuffix: string;
}

export interface ReportingConfig {
  serviceAccountJson: string;
  maxConcurrency: number;
  cronSecret: string | null;
  tenantTimeoutMs: number;
}

/** Cross-project service account used to read and manage managed projects. */
export interface ProjectAccessConfig {
  serviceAccountJson: string;
}

function readOptionalEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

function requireEnv(names: string[], scope: string): string[] {
  const missing = names.filter((name) => readOptionalEnv(name).length === 0);
  if (missing.length > 0) {
    throw new ConfigurationError(missing, scope);
  }
  return names.map((name) => readOptionalEnv(name));
}

function parseBoundedInteger(
  rawValue: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!rawValue) return fallback;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseEmailList(rawValue: string): string[] {
  const seen = new Set<string>();
  for (const entry of rawValue.split(',')) {
    const email = entry.trim().toLowerCase();
    if (!email) continue;
    if (!email.includes('@')) continue;
    seen.add(email);
  }
  return [...seen];
}

let cachedPlatformConfig: PlatformServerConfig | null = null;

export function getPlatformConfig(): PlatformServerConfig {
  if (cachedPlatformConfig) return cachedPlatformConfig;

  const edgeConfig = getEdgePlatformConfig();
  if (!edgeConfig.platformHost) {
    throw new ConfigurationError(['PLATFORM_HOST'], 'platform');
  }

  const adminEmails = parseEmailList(readOptionalEnv('PLATFORM_ADMIN_EMAILS'));
  if (adminEmails.length === 0) {
    throw new ConfigurationError(['PLATFORM_ADMIN_EMAILS'], 'platform');
  }

  cachedPlatformConfig = {
    platformHost: edgeConfig.platformHost,
    allowedDevHosts: edgeConfig.allowedDevHosts,
    acceptedOrigins: getAcceptedOrigins(edgeConfig),
    adminEmails,
    sessionTtlSeconds:
      parseBoundedInteger(readOptionalEnv('PLATFORM_SESSION_TTL_HOURS'), 8, 1, 24) * 60 * 60,
    revealFreshAuthSeconds: parseBoundedInteger(
      readOptionalEnv('PLATFORM_REVEAL_FRESH_AUTH_SECONDS'),
      300,
      30,
      900,
    ),
    ipAllowlist: edgeConfig.ipAllowlist,
    isDevelopment: edgeConfig.isDevelopment,
    e2eMode: isE2eMode(),
  };

  return cachedPlatformConfig;
}

/**
 * E2E mode is strictly a local development facility:
 * - it requires PLATFORM_E2E_MODE=true,
 * - it is refused when NODE_ENV=production,
 * - it is refused on Vercel.
 *
 * It swaps Firebase Auth for a deterministic local verifier and Firestore for
 * an in-memory store so Playwright can exercise the real route handlers.
 */
export function isE2eMode(): boolean {
  return (
    process.env.PLATFORM_E2E_MODE === 'true' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.VERCEL !== '1'
  );
}

export function getAdminFirebaseConfig(): AdminFirebaseConfig {
  const [projectId, clientEmail, rawPrivateKey] = requireEnv(
    [
      'PLATFORM_FIREBASE_PROJECT_ID',
      'PLATFORM_FIREBASE_CLIENT_EMAIL',
      'PLATFORM_FIREBASE_PRIVATE_KEY',
    ],
    'firebase-admin',
  ) as [string, string, string];

  const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new ConfigurationError(['PLATFORM_FIREBASE_PRIVATE_KEY'], 'firebase-admin');
  }

  return { projectId, clientEmail, privateKey };
}

export function getPublicFirebaseConfig(): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
} {
  const [apiKey, authDomain, projectId, appId] = requireEnv(
    [
      'NEXT_PUBLIC_FIREBASE_API_KEY',
      'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
      'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
      'NEXT_PUBLIC_FIREBASE_APP_ID',
    ],
    'public-firebase',
  ) as [string, string, string, string];
  return { apiKey, authDomain, projectId, appId };
}

let cachedSecretApiConfig: SecretApiConfig | null = null;

export function getSecretApiConfig(): SecretApiConfig {
  if (cachedSecretApiConfig) return cachedSecretApiConfig;
  const [baseUrl, adminServiceToken] = requireEnv(
    ['SECRET_API_BASE_URL', 'SECRET_API_ADMIN_SERVICE_TOKEN'],
    'secret-api',
  ) as [string, string];

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new ConfigurationError(['SECRET_API_BASE_URL'], 'secret-api');
  }
  if (parsedBaseUrl.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new ConfigurationError(['SECRET_API_BASE_URL'], 'secret-api');
  }

  cachedSecretApiConfig = {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    adminServiceToken,
    timeoutMs: parseBoundedInteger(readOptionalEnv('SECRET_API_TIMEOUT_MS'), 5000, 500, 30000),
  };
  return cachedSecretApiConfig;
}

let cachedCmsConfig: CmsConfig | null = null;

export function getCmsConfig(): CmsConfig {
  if (cachedCmsConfig) return cachedCmsConfig;
  const [baseUrl, apiKey] = requireEnv(
    ['CMS_SYSTEM_API_BASE_URL', 'CMS_SYSTEM_API_KEY'],
    'cms-system-api',
  ) as [string, string];

  cachedCmsConfig = {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    timeoutMs: parseBoundedInteger(readOptionalEnv('CMS_SYSTEM_API_TIMEOUT_MS'), 10000, 1000, 60000),
    cmsHostSuffix: readOptionalEnv('PLATFORM_CMS_HOST_SUFFIX') || 'cms.uniconhub.com',
    publicwebsiteHostSuffix:
      readOptionalEnv('PLATFORM_PUBLICWEBSITE_HOST_SUFFIX') || 'publicwebsite.uniconhub.com',
  };
  return cachedCmsConfig;
}

let cachedReportingConfig: ReportingConfig | null = null;

export function getReportingConfig(): ReportingConfig {
  if (cachedReportingConfig) return cachedReportingConfig;
  const rawServiceAccountJson =
    readOptionalEnv('PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON') ||
    readOptionalEnv('PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON');
  if (!rawServiceAccountJson) {
    throw new ConfigurationError(
      ['PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON', 'PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON'],
      'reporting',
    );
  }

  let parsedServiceAccount: unknown;
  try {
    parsedServiceAccount = JSON.parse(rawServiceAccountJson);
  } catch {
    // Never echo the JSON: it contains a private key.
    throw new ConfigurationError(
      ['PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON', 'PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON'],
      'reporting',
    );
  }
  if (
    typeof parsedServiceAccount !== 'object' ||
    parsedServiceAccount === null ||
    typeof (parsedServiceAccount as Record<string, unknown>).client_email !== 'string' ||
    typeof (parsedServiceAccount as Record<string, unknown>).private_key !== 'string'
  ) {
    throw new ConfigurationError(
      ['PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON', 'PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON'],
      'reporting',
    );
  }

  cachedReportingConfig = {
    serviceAccountJson: rawServiceAccountJson,
    maxConcurrency: parseBoundedInteger(
      readOptionalEnv('PLATFORM_REPORTING_MAX_CONCURRENCY'),
      3,
      1,
      10,
    ),
    cronSecret: readOptionalEnv('PLATFORM_REPORTING_CRON_SECRET') || null,
    tenantTimeoutMs: parseBoundedInteger(
      readOptionalEnv('PLATFORM_REPORTING_TENANT_TIMEOUT_MS'),
      10000,
      1000,
      60000,
    ),
  };
  return cachedReportingConfig;
}

let cachedProjectAccessConfig: ProjectAccessConfig | null = null;

/**
 * Credentials for reaching managed projects. A dedicated service account is
 * preferred; the reporting account is accepted as a read-only fallback so a
 * fresh deployment can list tenants before write access is granted.
 */
export function getProjectAccessConfig(): ProjectAccessConfig {
  if (cachedProjectAccessConfig) return cachedProjectAccessConfig;

  const rawServiceAccountJson =
    readOptionalEnv('PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON') ||
    readOptionalEnv('PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON');
  if (!rawServiceAccountJson) {
    throw new ConfigurationError(['PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON'], 'projects');
  }

  let parsedServiceAccount: unknown;
  try {
    parsedServiceAccount = JSON.parse(rawServiceAccountJson);
  } catch {
    // Never echo the JSON: it contains a private key.
    throw new ConfigurationError(['PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON'], 'projects');
  }
  if (
    typeof parsedServiceAccount !== 'object' ||
    parsedServiceAccount === null ||
    typeof (parsedServiceAccount as Record<string, unknown>).client_email !== 'string' ||
    typeof (parsedServiceAccount as Record<string, unknown>).private_key !== 'string'
  ) {
    throw new ConfigurationError(['PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON'], 'projects');
  }

  cachedProjectAccessConfig = { serviceAccountJson: rawServiceAccountJson };
  return cachedProjectAccessConfig;
}

/** Test-only: clears memoised configuration between test cases. */
export function resetServerEnvCacheForTesting(): void {
  cachedPlatformConfig = null;
  cachedSecretApiConfig = null;
  cachedCmsConfig = null;
  cachedReportingConfig = null;
  cachedProjectAccessConfig = null;
}
