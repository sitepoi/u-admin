import 'server-only';

import { getFirestore, type Firestore, type Query } from 'firebase-admin/firestore';

import { getPlatformFirestore } from '@/lib/server/firebase/admin';
import { getProjectFirebaseApp } from '@/lib/server/firebase/project-app';
import type {
  RelayTenantSummary,
  TenantAppStats,
  TenantStats,
  TenantStatsRollup,
} from '@/lib/shared/platform-types';

export const TENANT_STATS_COLLECTION = 'platform_tenant_stats';

const COUNT_CONCURRENCY = 4;
const WEBSITE_BUILDER_FALLBACK_ID = 'website-builder-uniconbaseapps';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readNestedString(
  source: Record<string, unknown>,
  ...path: string[]
): string {
  let current: unknown = source;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return '';
    current = record[key];
  }
  return asString(current);
}

/** settings, sp_contents, users and others take "-<tableExtension>". */
function tableSuffix(tenant: RelayTenantSummary): string {
  const extension = tenant.tableExtension.trim();
  if (!extension) return '';
  return extension.startsWith('-') ? extension : `-${extension}`;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const compact = message.replace(/\s+/g, ' ').trim().slice(0, 300);
  return /index/i.test(compact) ? `${compact} (create the composite index and retry)` : compact;
}

async function countWhere(
  database: Firestore,
  collectionName: string,
  filters: ReadonlyArray<readonly [string, string]>,
): Promise<number> {
  let query: Query = database.collection(collectionName);
  for (const [field, value] of filters) {
    query = query.where(field, '==', value);
  }
  const snapshot = await query.count().get();
  return snapshot.data().count;
}

async function safeCountWhere(
  database: Firestore,
  collectionName: string,
  filters: ReadonlyArray<readonly [string, string]>,
): Promise<{ value: number | null; error: string | null }> {
  try {
    return {
      value: await countWhere(database, collectionName, filters),
      error: null,
    };
  } catch (error) {
    return { value: null, error: describeError(error) };
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
  return results;
}

interface ParsedApp {
  appId: string;
  name: string;
  version: string;
  remote: boolean;
  disabled: boolean;
  saveState: string;
  publicAccess: string;
  isWebsiteBuilder: boolean;
}

function parseApps(objectTypes: unknown): ParsedApp[] {
  if (!Array.isArray(objectTypes)) return [];

  return objectTypes
    .map((entry): ParsedApp | null => {
      const app = asRecord(entry);
      if (!app) return null;
      const appId = asString(app.id);
      if (!appId) return null;

      return {
        appId,
        name: asString(app.name) || appId,
        version: asString(app.version),
        remote: app.useFromRemote === 'yes',
        disabled: app.disabled === 'yes',
        saveState: asString(app._status),
        publicAccess: readNestedString(app, 'rules', 'publicAccess'),
        isWebsiteBuilder:
          readNestedString(app, 'folderConfigSection', 'storageKey') === 'websiteConfig',
      };
    })
    .filter((entry): entry is ParsedApp => entry !== null);
}

function objectTableForApp(app: ParsedApp): TenantAppStats['objectTable'] {
  if (app.appId === 'products') return 'pm_products';
  return app.publicAccess === 'no' ? 'om_private_objects' : 'om_objects';
}

/**
 * Collects one tenant's statistics using Firestore count aggregations.
 * Reads only; the only write happens later, in the admin project cache.
 */
export async function collectTenantStats(tenant: RelayTenantSummary): Promise<TenantStats> {
  const startedAt = Date.now();
  const errors: string[] = [];
  const suffix = tableSuffix(tenant);

  let database: Firestore;
  try {
    database = getFirestore(getProjectFirebaseApp(tenant.projectId));
  } catch (error) {
    return {
      projectId: tenant.projectId,
      tenantId: tenant.tenantId,
      applicationId: tenant.applicationId,
      computedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      status: 'failed',
      applicationCount: 0,
      enabledApplicationCount: 0,
      remoteApplicationCount: 0,
      totalObjectCount: null,
      objectCounts: { omObjects: null, omPrivateObjects: null, pmProducts: null },
      applications: [],
      websiteBuilderAppId: null,
      websiteBuilderPageCount: null,
      contentManagerItemCount: null,
      errors: [describeError(error)],
    };
  }

  let parsedApps: ParsedApp[] = [];
  const settingsCollection = `settings${suffix}`;
  const settingsDocumentId = `cms-settings-${tenant.tenantId}`;
  let settingsRead = false;

  try {
    const settingsSnapshot = await database
      .collection(settingsCollection)
      .doc(settingsDocumentId)
      .get();
    if (!settingsSnapshot.exists) {
      errors.push(`${settingsCollection}/${settingsDocumentId} was not found.`);
    } else {
      parsedApps = parseApps(settingsSnapshot.get('objectTypes'));
      settingsRead = true;
    }
  } catch (error) {
    errors.push(`settings read failed: ${describeError(error)}`);
  }

  const applications: TenantAppStats[] = await mapWithConcurrency(
    parsedApps,
    COUNT_CONCURRENCY,
    async (app): Promise<TenantAppStats> => {
      const objectTable = objectTableForApp(app);
      const result = await safeCountWhere(
        database,
        objectTable,
        objectTable === 'pm_products'
          ? [['tenantId', tenant.tenantId]]
          : [
              ['cmsObjectType', app.appId],
              ['tenantId', tenant.tenantId],
            ],
      );
      if (result.error) errors.push(`${app.appId}: ${result.error}`);
      if (objectTable === 'pm_products') {
        errors.push(
          'Products app counted from pm_products by tenantId; its cmsObjectType link is not verified.',
        );
      }

      return {
        appId: app.appId,
        name: app.name,
        version: app.version,
        scope: app.remote ? 'remote' : 'local',
        disabled: app.disabled,
        saveState: app.saveState,
        objectTable,
        objectCount: result.value,
      };
    },
  );

  const [omObjects, omPrivateObjects, pmProducts] = await Promise.all([
    safeCountWhere(database, 'om_objects', [['tenantId', tenant.tenantId]]),
    safeCountWhere(database, 'om_private_objects', [['tenantId', tenant.tenantId]]),
    safeCountWhere(database, 'pm_products', [['tenantId', tenant.tenantId]]),
  ]);

  for (const [label, result] of [
    ['om_objects total', omObjects],
    ['om_private_objects total', omPrivateObjects],
    ['pm_products total', pmProducts],
  ] as const) {
    if (result.error) errors.push(`${label}: ${result.error}`);
  }

  const knownTotals = [omObjects.value, omPrivateObjects.value, pmProducts.value].filter(
    (value): value is number => value !== null,
  );
  const totalObjectCount =
    knownTotals.length === 0 ? null : knownTotals.reduce((total, value) => total + value, 0);

  const websiteBuilderApp =
    parsedApps.find((app) => app.isWebsiteBuilder) ??
    parsedApps.find((app) => app.appId === WEBSITE_BUILDER_FALLBACK_ID) ??
    null;

  let websiteBuilderPageCount: number | null = null;
  if (websiteBuilderApp) {
    const result = await safeCountWhere(
      database,
      objectTableForApp(websiteBuilderApp),
      [
        ['cmsObjectType', websiteBuilderApp.appId],
        ['tenantId', tenant.tenantId],
      ],
    );
    if (result.error) errors.push(`Website Builder pages: ${result.error}`);
    websiteBuilderPageCount = result.value;
  }

  const contentCollection = `sp_contents${suffix}`;
  let contentManagerItemCount: number | null = null;
  try {
    const total = await countWhere(database, contentCollection, [
      ['tenantId', tenant.tenantId],
    ]);
    let excludedSettingsItem = 0;
    const settingsItem = await database
      .collection(contentCollection)
      .doc('settings-items')
      .get();
    if (
      settingsItem.exists &&
      asString(settingsItem.get('tenantId')) === tenant.tenantId
    ) {
      excludedSettingsItem = 1;
    }
    contentManagerItemCount = Math.max(0, total - excludedSettingsItem);
  } catch (error) {
    errors.push(`Content Manager items: ${describeError(error)}`);
  }

  const status: TenantStats['status'] =
    !settingsRead && applications.length === 0
      ? 'failed'
      : errors.length > 0
        ? 'partial'
        : 'ok';

  return {
    projectId: tenant.projectId,
    tenantId: tenant.tenantId,
    applicationId: tenant.applicationId,
    computedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    status,
    applicationCount: applications.length,
    enabledApplicationCount: applications.filter((app) => !app.disabled).length,
    remoteApplicationCount: applications.filter((app) => app.scope === 'remote').length,
    totalObjectCount,
    objectCounts: {
      omObjects: omObjects.value,
      omPrivateObjects: omPrivateObjects.value,
      pmProducts: pmProducts.value,
    },
    applications,
    websiteBuilderAppId: websiteBuilderApp?.appId ?? null,
    websiteBuilderPageCount,
    contentManagerItemCount,
    errors: [...new Set(errors)],
  };
}

export function tenantStatsDocumentId(projectId: string, tenantId: string): string {
  return `${projectId}__${tenantId}`.replace(/\//g, '_');
}

export async function getTenantStats(
  projectId: string,
  tenantId: string,
): Promise<TenantStats | null> {
  const snapshot = await getPlatformFirestore()
    .collection(TENANT_STATS_COLLECTION)
    .doc(tenantStatsDocumentId(projectId, tenantId))
    .get();
  if (!snapshot.exists) return null;
  return snapshot.data() as TenantStats;
}

export async function saveTenantStats(stats: TenantStats): Promise<void> {
  await getPlatformFirestore()
    .collection(TENANT_STATS_COLLECTION)
    .doc(tenantStatsDocumentId(stats.projectId, stats.tenantId))
    .set(stats);
}

/** Cheap dashboard rollup: reads only the cached statistics documents. */
export async function getTenantStatsRollup(): Promise<TenantStatsRollup> {
  const snapshot = await getPlatformFirestore()
    .collection(TENANT_STATS_COLLECTION)
    .limit(1000)
    .get();

  let applicationCount = 0;
  let totalObjectCount = 0;
  let websiteBuilderPageCount = 0;
  let contentManagerItemCount = 0;
  let latestComputedAt: string | null = null;

  for (const document of snapshot.docs) {
    const stats = document.data() as TenantStats;
    applicationCount += stats.applicationCount ?? 0;
    totalObjectCount += stats.totalObjectCount ?? 0;
    websiteBuilderPageCount += stats.websiteBuilderPageCount ?? 0;
    contentManagerItemCount += stats.contentManagerItemCount ?? 0;
    if (!latestComputedAt || stats.computedAt > latestComputedAt) {
      latestComputedAt = stats.computedAt;
    }
  }

  return {
    tenantCount: snapshot.size,
    applicationCount,
    totalObjectCount,
    websiteBuilderPageCount,
    contentManagerItemCount,
    latestComputedAt,
  };
}
