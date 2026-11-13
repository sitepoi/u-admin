import 'server-only';

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';

import type { TenantStatus } from '@/lib/shared/constants';
import type {
  PlatformReportMetrics,
  ReportSnapshot,
  SecretHealthCounts,
  TenantReportMetrics,
} from '@/lib/shared/platform-types';
import { getReportingConfig, type ReportingConfig } from '@/lib/server/env';
import { getPlatformStore } from '@/lib/server/firestore/store-provider';
import { buildSnapshotId, getReportingPeriod, type TenantRecord } from '@/lib/server/firestore/store';
import { logWarn } from '@/lib/server/logging/logger';
import { countSecretHealth, listSecretMetadata } from '@/lib/server/secret-api-client/client';

interface ReportingTargets {
  objectsCollection: string;
  objectTypeField: string;
  apiRequestsCollection: string;
  apiVersionField: string;
  firstPartyRequestsCollection: string;
  firstPartyErrorField: string;
  usersCollection: string;
  storageCollection: string;
  storageDocumentId: string;
}

function readTargets(): ReportingTargets {
  return {
    objectsCollection: process.env.PLATFORM_REPORTING_OBJECT_COLLECTION || 'objects',
    objectTypeField: process.env.PLATFORM_REPORTING_OBJECT_TYPE_FIELD || 'objectTypeId',
    apiRequestsCollection: process.env.PLATFORM_REPORTING_API_REQUEST_COLLECTION || 'api_requests',
    apiVersionField: process.env.PLATFORM_REPORTING_API_VERSION_FIELD || 'apiVersion',
    firstPartyRequestsCollection:
      process.env.PLATFORM_REPORTING_FIRST_PARTY_COLLECTION || 'first_party_requests',
    firstPartyErrorField: process.env.PLATFORM_REPORTING_FIRST_PARTY_ERROR_FIELD || 'isError',
    usersCollection: process.env.PLATFORM_REPORTING_USERS_COLLECTION || 'users',
    storageCollection: process.env.PLATFORM_REPORTING_STORAGE_COLLECTION || 'platform_usage',
    storageDocumentId: 'current',
  };
}

const reportingAppCache = new Map<string, App>();

/**
 * Each tenant CMS lives in its own Firebase project. A single read-only service
 * account gets per-project Admin apps; only aggregate numbers leave the tenant
 * project.
 */
function getReportingFirestoreForProject(projectId: string): Firestore {
  const appName = `platform-reporting-${projectId}`;
  const cachedApp = reportingAppCache.get(projectId) ?? getApps().find((app) => app.name === appName);

  if (cachedApp) {
    reportingAppCache.set(projectId, cachedApp);
    return getFirestore(cachedApp);
  }

  const config = getReportingConfig();
  let parsedServiceAccount: { client_email?: string; private_key?: string; project_id?: string };
  try {
    parsedServiceAccount = JSON.parse(config.serviceAccountJson) as typeof parsedServiceAccount;
  } catch {
    throw new Error('Reporting service account JSON is invalid.');
  }

  if (!parsedServiceAccount.client_email || !parsedServiceAccount.private_key) {
    throw new Error('Reporting service account JSON is incomplete.');
  }

  const app = initializeApp(
    {
      credential: cert({
        projectId: parsedServiceAccount.project_id ?? projectId,
        clientEmail: parsedServiceAccount.client_email,
        privateKey: parsedServiceAccount.private_key.replace(/\\n/g, '\n'),
      }),
      projectId,
    },
    appName,
  );
  reportingAppCache.set(projectId, app);
  return getFirestore(app);
}

async function countDocuments(query: Query): Promise<number> {
  const snapshot = await query.count().get();
  return snapshot.data().count;
}

function sanitizeCollectionError(error: unknown): string {
  if (error instanceof Error) {
    // Firestore messages are safe for operator eyes; truncate to keep snapshots
    // compact and strip anything token-shaped.
    return error.message.replace(/\s+/g, ' ').slice(0, 300);
  }
  return 'Unknown collection error.';
}

async function collectTenantMetrics(
  tenant: TenantRecord,
  previousLastError: string | null,
): Promise<{ metrics: TenantReportMetrics; errors: string[] }> {
  const targets = readTargets();
  const database = getReportingFirestoreForProject(tenant.cmsProjectId);
  const errors: string[] = [];
  const startedAt = Date.now();

  async function safeMetric<T>(
    label: string,
    collect: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await collect();
    } catch (error) {
      errors.push(`${label}: ${sanitizeCollectionError(error)}`);
      return fallback;
    }
  }

  const startOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const objectCountTotal = await safeMetric(
    'objects.count',
    () => countDocuments(database.collection(targets.objectsCollection)),
    null,
  );

  const objectCountByType = await safeMetric(
    'objects.byType',
    async () => {
      // Bounded sample: only the type field is read and only counts are stored.
      const sample = await database
        .collection(targets.objectsCollection)
        .select(targets.objectTypeField)
        .limit(500)
        .get();
      const counts: Record<string, number> = {};
      for (const document of sample.docs) {
        const typeValue = document.get(targets.objectTypeField);
        if (typeof typeValue === 'string' && typeValue.length > 0) {
          counts[typeValue] = (counts[typeValue] ?? 0) + 1;
        }
      }
      return Object.fromEntries(
        Object.entries(counts)
          .sort((left, right) => right[1] - left[1])
          .slice(0, 10),
      );
    },
    {},
  );

  const apiRequestsV1 = await safeMetric(
    'apiRequests.v1',
    () =>
      countDocuments(
        database
          .collection(targets.apiRequestsCollection)
          .where('createdAt', '>=', Timestamp.fromDate(startOfMonth))
          .where(targets.apiVersionField, '==', 'v1'),
      ),
    null,
  );

  const apiRequestsV2 = await safeMetric(
    'apiRequests.v2',
    () =>
      countDocuments(
        database
          .collection(targets.apiRequestsCollection)
          .where('createdAt', '>=', Timestamp.fromDate(startOfMonth))
          .where(targets.apiVersionField, '==', 'v2'),
      ),
    null,
  );

  const firstPartyRequests = await safeMetric(
    'firstParty.requests',
    () =>
      countDocuments(
        database
          .collection(targets.firstPartyRequestsCollection)
          .where('createdAt', '>=', Timestamp.fromDate(startOfMonth)),
      ),
    null,
  );

  const firstPartyErrors = await safeMetric(
    'firstParty.errors',
    () =>
      countDocuments(
        database
          .collection(targets.firstPartyRequestsCollection)
          .where('createdAt', '>=', Timestamp.fromDate(startOfMonth))
          .where(targets.firstPartyErrorField, '==', true),
      ),
    null,
  );

  const activeUsers30d = await safeMetric(
    'users.active30d',
    () =>
      countDocuments(
        database
          .collection(targets.usersCollection)
          .where('lastActiveAt', '>=', Timestamp.fromDate(thirtyDaysAgo)),
      ),
    null,
  );

  const storageBytes = await safeMetric<number | null>(
    'storage.bytes',
    async () => {
      const snapshot = await database
        .collection(targets.storageCollection)
        .doc(targets.storageDocumentId)
        .get();
      if (!snapshot.exists) return null;
      const value = snapshot.get('storageBytes');
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    },
    null,
  );

  const apiRequestsTotal =
    apiRequestsV1 === null && apiRequestsV2 === null
      ? null
      : (apiRequestsV1 ?? 0) + (apiRequestsV2 ?? 0);

  return {
    metrics: {
      tenantId: tenant.tenantId,
      displayName: tenant.displayName,
      objectCountTotal,
      objectCountByType,
      apiRequestsThisMonth:
        apiRequestsTotal === null
          ? null
          : {
              v1: apiRequestsV1 ?? 0,
              v2: apiRequestsV2 ?? 0,
              total: apiRequestsTotal,
            },
      firstParty:
        firstPartyRequests === null && firstPartyErrors === null
          ? null
          : { requests: firstPartyRequests ?? 0, errors: firstPartyErrors ?? 0 },
      activeUsers30d,
      storageBytes,
      lastError: previousLastError,
      collectedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    },
    errors,
  };
}

function emptyTenantMetrics(tenant: TenantRecord, message: string): TenantReportMetrics {
  return {
    tenantId: tenant.tenantId,
    displayName: tenant.displayName,
    objectCountTotal: null,
    objectCountByType: {},
    apiRequestsThisMonth: null,
    firstParty: null,
    activeUsers30d: null,
    storageBytes: null,
    lastError: message,
    collectedAt: new Date().toISOString(),
    durationMs: 0,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await mapper(items[currentIndex]!);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function aggregatePlatformMetrics(
  tenants: readonly TenantRecord[],
  tenantMetrics: readonly TenantReportMetrics[],
  secretHealth: SecretHealthCounts,
  collectionFailures: number,
): PlatformReportMetrics {
  const tenantsByStatus: Record<string, number> = {};
  for (const tenant of tenants) {
    tenantsByStatus[tenant.status] = (tenantsByStatus[tenant.status] ?? 0) + 1;
  }

  const totals = {
    objectCount: 0,
    apiRequestsThisMonth: 0,
    firstPartyRequests: 0,
    firstPartyErrors: 0,
    activeUsers30d: 0,
    storageBytes: 0,
  };

  for (const metrics of tenantMetrics) {
    totals.objectCount += metrics.objectCountTotal ?? 0;
    totals.apiRequestsThisMonth += metrics.apiRequestsThisMonth?.total ?? 0;
    totals.firstPartyRequests += metrics.firstParty?.requests ?? 0;
    totals.firstPartyErrors += metrics.firstParty?.errors ?? 0;
    totals.activeUsers30d += metrics.activeUsers30d ?? 0;
    totals.storageBytes += metrics.storageBytes ?? 0;
  }

  return {
    tenantCount: tenants.length,
    tenantsByStatus,
    totals,
    secretHealth,
    collectionFailures,
  };
}

export interface ReportingRefreshResult {
  period: string;
  collectedAt: string;
  tenantCount: number;
  tenantFailureCount: number;
  platformSnapshot: ReportSnapshot;
  tenantSnapshots: ReportSnapshot[];
}

/**
 * Refreshes every tenant snapshot plus the platform roll-up. Reads aggregates
 * only; raw tenant documents never leave their project.
 */
export async function refreshReporting(options: {
  requestId: string;
}): Promise<ReportingRefreshResult> {
  const config: ReportingConfig = getReportingConfig();
  const store = getPlatformStore();
  const tenants = await store.listTenants();
  const period = getReportingPeriod();
  const collectedAt = new Date().toISOString();

  const results = await mapWithConcurrency(tenants, config.maxConcurrency, async (tenant) => {
    if (!tenant.cmsProjectId) {
      return {
        tenant,
        metrics: emptyTenantMetrics(tenant, 'Tenant has no cmsProjectId.'),
        errors: ['Missing cmsProjectId.'],
      };
    }
    try {
      const collected = await withTimeout(
        collectTenantMetrics(tenant, tenant.provisioning.lastError ?? tenant.reporting.lastError),
        config.tenantTimeoutMs,
        `Timed out after ${config.tenantTimeoutMs}ms.`,
      );
      return { tenant, metrics: collected.metrics, errors: collected.errors };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown reporting error.';
      logWarn('reporting.tenant_failed', {
        tenantId: tenant.tenantId,
        requestId: options.requestId,
        message,
      });
      return {
        tenant,
        metrics: emptyTenantMetrics(tenant, message),
        errors: [message],
      };
    }
  });

  const tenantSnapshots: ReportSnapshot[] = [];
  const successfulMetrics: TenantReportMetrics[] = [];
  let tenantFailureCount = 0;

  for (const result of results) {
    const status: ReportSnapshot['status'] = result.errors.length === 0 ? 'ok' : 'partial';
    if (result.errors.length > 0) tenantFailureCount += 1;
    if (result.metrics.objectCountTotal !== null || result.errors.length === 0) {
      successfulMetrics.push(result.metrics);
    }

    const snapshot: ReportSnapshot = {
      snapshotId: buildSnapshotId(result.tenant.tenantId, period),
      tenantId: result.tenant.tenantId,
      period,
      metrics: result.metrics,
      status,
      errors: result.errors,
      collectedAt,
    };
    await store.saveSnapshot(snapshot);
    await store.updateTenant(result.tenant.tenantId, {
      reporting: {
        lastRefreshAt: collectedAt,
        lastError: result.errors[0] ?? null,
      },
      updatedAt: collectedAt,
    });
    tenantSnapshots.push(snapshot);
  }

  let secretHealth: SecretHealthCounts = {
    active: 0,
    pendingDelivery: 0,
    failedDelivery: 0,
    rotationDue: 0,
    retired: 0,
    total: 0,
  };
  let secretHealthError: string | null = null;
  try {
    const secrets = await listSecretMetadata({ requestId: options.requestId }, undefined, {
      useCache: false,
    });
    secretHealth = countSecretHealth(secrets);
  } catch (error) {
    secretHealthError = error instanceof Error ? error.message : 'Secret API unavailable.';
    logWarn('reporting.secret_health_failed', {
      requestId: options.requestId,
      message: secretHealthError,
    });
  }

  const platformMetrics = aggregatePlatformMetrics(
    tenants,
    successfulMetrics,
    secretHealth,
    tenantFailureCount,
  );

  const platformStatus: ReportSnapshot['status'] =
    tenants.length === 0
      ? 'ok'
      : tenantFailureCount === 0 && secretHealthError === null
        ? 'ok'
        : tenantFailureCount >= tenants.length
          ? 'failed'
          : 'partial';

  const platformSnapshot: ReportSnapshot = {
    snapshotId: buildSnapshotId(null, period),
    tenantId: null,
    period,
    metrics: platformMetrics,
    status: platformStatus,
    errors: secretHealthError ? [`secretHealth: ${secretHealthError}`] : [],
    collectedAt,
  };
  await store.saveSnapshot(platformSnapshot);

  return {
    period,
    collectedAt,
    tenantCount: tenants.length,
    tenantFailureCount,
    platformSnapshot,
    tenantSnapshots,
  };
}

export interface ReportingSummary {
  platformSnapshot: ReportSnapshot | null;
  tenantSnapshots: ReportSnapshot[];
  tenantCount: number;
  tenantsByStatus: Record<TenantStatus, number>;
  secretHealth: SecretHealthCounts | null;
  lastRefreshAt: string | null;
  lastError: string | null;
  collectionFailures: number;
}

/**
 * Dashboard reads use cached snapshots only: page loads never fan out across
 * tenant projects.
 */
export async function getReportingSummary(): Promise<ReportingSummary> {
  const store = getPlatformStore();
  const [tenants, platformSnapshot, tenantSnapshots] = await Promise.all([
    store.listTenants(),
    store.getLatestSnapshot(null),
    store.listSnapshots(null, 6),
  ]);

  const tenantsByStatus: Record<TenantStatus, number> = {
    draft: 0,
    provisioning: 0,
    active: 0,
    suspended: 0,
    archived: 0,
    failed: 0,
  };
  for (const tenant of tenants) {
    tenantsByStatus[tenant.status] = (tenantsByStatus[tenant.status] ?? 0) + 1;
  }

  const platformMetrics = platformSnapshot?.metrics;
  const isPlatformMetrics =
    platformMetrics !== undefined &&
    platformMetrics !== null &&
    'secretHealth' in platformMetrics;

  return {
    platformSnapshot,
    tenantSnapshots,
    tenantCount: tenants.length,
    tenantsByStatus,
    secretHealth: isPlatformMetrics ? platformMetrics.secretHealth : null,
    lastRefreshAt: platformSnapshot?.collectedAt ?? null,
    lastError: platformSnapshot?.errors[0] ?? null,
    collectionFailures: isPlatformMetrics ? platformMetrics.collectionFailures : 0,
  };
}

/** Tenant snapshots for the tenant detail page. */
export async function getTenantSnapshots(tenantId: string, limit = 6): Promise<ReportSnapshot[]> {
  return getPlatformStore().listSnapshots(tenantId, limit);
}
