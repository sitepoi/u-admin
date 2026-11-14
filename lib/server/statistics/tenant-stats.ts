import 'server-only';

import { Buffer } from 'node:buffer';

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

function maxIsoTimestamp(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  if (present.length === 0) return null;
  present.sort();
  return present[present.length - 1] ?? null;
}

function timestampToString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

async function newestTimestamp(
  database: Firestore,
  collectionName: string,
  tenantId: string,
  field: string,
): Promise<{ value: string | null; error: string | null }> {
  try {
    const snapshot = await database
      .collection(collectionName)
      .where('tenantId', '==', tenantId)
      .orderBy(field, 'desc')
      .limit(1)
      .get();
    if (snapshot.empty) return { value: null, error: null };
    return { value: timestampToString(snapshot.docs[0].get(field)), error: null };
  } catch (error) {
    return { value: null, error: describeError(error) };
  }
}

function estimateRegistryBytes(objectTypes: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(objectTypes ?? []), 'utf8');
  } catch {
    return null;
  }
}

function engagementScore(newestActivityAt: string | null): number {
  if (!newestActivityAt) return 0;
  const ageMs = Date.now() - Date.parse(newestActivityAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 100;
  const ageDays = Math.floor(ageMs / 86_400_000);
  if (ageDays <= 7) return 100;
  if (ageDays <= 30) return 70;
  if (ageDays <= 90) return 40;
  if (ageDays <= 180) return 20;
  return 5;
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
      disabledApplicationCount: 0,
      remoteApplicationCount: 0,
      localApplicationCount: 0,
      duplicateAppIds: [],
      appRegistryBytes: null,
      totalObjectCount: null,
      objectCounts: { omObjects: null, omPrivateObjects: null, pmProducts: null },
      objectStatusCounts: {
        publicEnabled: null,
        publicDisabled: null,
        privateEnabled: null,
        privateDisabled: null,
      },
      newestObjectCreatedAt: null,
      newestObjectUpdatedAt: null,
      userCount: null,
      newestUserCreatedAt: null,
      applications: [],
      websiteBuilderAppId: null,
      websiteBuilderPageCount: null,
      contentManagerItemCount: null,
      newestContentUpdatedAt: null,
      legacy: {
        contentItemCount: null,
        contentTypeCount: null,
        productCount: null,
        productTypeCount: null,
        productCategoryCount: null,
        legacyApiCallCount: null,
        oldVersionHistoryCount: null,
        snapshotCount: null,
        formTypeCount: null,
        formSubmissionCount: null,
        aggregatedListCount: null,
        publicToPrivateLeftoverCount: null,
      },
      migrationTag: 'unknown',
      scores: { adoption: 0, engagement: 0, legacyRisk: 0, operationalRisk: 100 },
      errors: [describeError(error)],
    };
  }

  let parsedApps: ParsedApp[] = [];
  let objectTypesRaw: unknown = [];
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
      objectTypesRaw = settingsSnapshot.get('objectTypes');
      parsedApps = parseApps(objectTypesRaw);
      settingsRead = true;
    }
  } catch (error) {
    errors.push(`settings read failed: ${describeError(error)}`);
  }

  const appIds = parsedApps.map((app) => app.appId);
  const duplicateAppIds = [
    ...new Set(appIds.filter((appId, index) => appIds.indexOf(appId) !== index)),
  ];
  if (duplicateAppIds.length > 0) {
    errors.push(`Duplicate app ids in objectTypes: ${duplicateAppIds.join(', ')}.`);
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

      const folderResult = await safeCountWhere(database, 'om_object_types', [
        ['mainObjectType', app.appId],
        ['tenantId', tenant.tenantId],
      ]);
      if (folderResult.error) {
        errors.push(`${app.appId} folders: ${folderResult.error}`);
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
        folderCount: folderResult.value,
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

  const [publicEnabled, publicDisabled, privateEnabled, privateDisabled] = await Promise.all([
    safeCountWhere(database, 'om_objects', [
      ['tenantId', tenant.tenantId],
      ['meta.status', 'enabled'],
    ]),
    safeCountWhere(database, 'om_objects', [
      ['tenantId', tenant.tenantId],
      ['meta.status', 'disabled'],
    ]),
    safeCountWhere(database, 'om_private_objects', [
      ['tenantId', tenant.tenantId],
      ['meta.status', 'enabled'],
    ]),
    safeCountWhere(database, 'om_private_objects', [
      ['tenantId', tenant.tenantId],
      ['meta.status', 'disabled'],
    ]),
  ]);
  for (const [label, result] of [
    ['om_objects enabled', publicEnabled],
    ['om_objects disabled', publicDisabled],
    ['om_private_objects enabled', privateEnabled],
    ['om_private_objects disabled', privateDisabled],
  ] as const) {
    if (result.error) errors.push(`${label}: ${result.error}`);
  }

  const [newestPublicCreated, newestPrivateCreated, newestPublicUpdated, newestPrivateUpdated] =
    await Promise.all([
      newestTimestamp(database, 'om_objects', tenant.tenantId, 'created'),
      newestTimestamp(database, 'om_private_objects', tenant.tenantId, 'created'),
      newestTimestamp(database, 'om_objects', tenant.tenantId, 'lastUpdated'),
      newestTimestamp(database, 'om_private_objects', tenant.tenantId, 'lastUpdated'),
    ]);
  for (const [label, result] of [
    ['om_objects newest created', newestPublicCreated],
    ['om_private_objects newest created', newestPrivateCreated],
    ['om_objects newest updated', newestPublicUpdated],
    ['om_private_objects newest updated', newestPrivateUpdated],
  ] as const) {
    if (result.error) errors.push(`${label}: ${result.error}`);
  }

  const userCollection = `users${suffix}`;
  const userCount = await safeCountWhere(database, userCollection, [
    ['tenantId', tenant.tenantId],
  ]);
  if (userCount.error) errors.push(`users count: ${userCount.error}`);
  const newestUserCreated = await newestTimestamp(
    database,
    userCollection,
    tenant.tenantId,
    'created',
  );
  if (newestUserCreated.error) errors.push(`users newest created: ${newestUserCreated.error}`);

  const contentTypeCount = await safeCountWhere(database, `sp_content_types${suffix}`, [
    ['tenantId', tenant.tenantId],
  ]);
  if (contentTypeCount.error) errors.push(`sp_content_types count: ${contentTypeCount.error}`);

  const newestContentUpdated = await newestTimestamp(
    database,
    contentCollection,
    tenant.tenantId,
    'lastUpdated',
  );
  if (newestContentUpdated.error) {
    errors.push(`sp_contents newest updated: ${newestContentUpdated.error}`);
  }

  const legacyCounts = await Promise.all([
    safeCountWhere(database, 'pm_product_types', [['tenantId', tenant.tenantId]]),
    safeCountWhere(database, `pm_product_categories${suffix}`, [
      ['tenantId', tenant.tenantId],
    ]),
    safeCountWhere(database, 'om_api_legacy_calls', [['tenantId', tenant.tenantId]]),
    safeCountWhere(database, 'om_object_version_history', [['tenantId', tenant.tenantId]]),
    safeCountWhere(database, `pm_entity_snapshots${suffix}`, [['tenantId', tenant.tenantId]]),
    safeCountWhere(database, `form_types${suffix}`, [['tenantId', tenant.tenantId]]),
    safeCountWhere(database, 'form_submissions', [['tenantId', tenant.tenantId]]),
    safeCountWhere(database, 'om_aggregated_object_lists', [['tenantId', tenant.tenantId]]),
  ]);
  const legacyLabels = [
    'pm_product_types',
    'pm_product_categories',
    'om_api_legacy_calls',
    'om_object_version_history',
    'pm_entity_snapshots',
    'form_types',
    'form_submissions',
    'om_aggregated_object_lists',
  ] as const;
  legacyCounts.forEach((result, index) => {
    if (result.error) errors.push(`${legacyLabels[index]}: ${result.error}`);
  });
  const [
    productTypeCount,
    productCategoryCount,
    legacyApiCallCount,
    oldVersionHistoryCount,
    snapshotCount,
    formTypeCount,
    formSubmissionCount,
    aggregatedListCount,
  ] = legacyCounts;

  const privateApps = parsedApps.filter(
    (app) => app.publicAccess === 'no' && app.appId !== 'products',
  );
  let publicToPrivateLeftoverCount: number | null = 0;
  for (const app of privateApps) {
    const result = await safeCountWhere(database, 'om_objects', [
      ['cmsObjectType', app.appId],
      ['tenantId', tenant.tenantId],
    ]);
    if (result.error) {
      publicToPrivateLeftoverCount = null;
      errors.push(`public-to-private leftovers (${app.appId}): ${result.error}`);
    } else if (
      publicToPrivateLeftoverCount !== null &&
      result.value !== null
    ) {
      publicToPrivateLeftoverCount += result.value;
    }
  }

  const newestObjectCreatedAt = maxIsoTimestamp([
    newestPublicCreated.value,
    newestPrivateCreated.value,
  ]);
  const newestObjectUpdatedAt = maxIsoTimestamp([
    newestPublicUpdated.value,
    newestPrivateUpdated.value,
  ]);
  const newestActivityAt = maxIsoTimestamp([
    newestObjectUpdatedAt,
    newestContentUpdated.value,
    newestUserCreated.value,
  ]);

  const hasLegacyContent =
    (contentManagerItemCount ?? 0) > 0 || (contentTypeCount.value ?? 0) > 0;
  const hasLegacyProducts =
    (pmProducts.value ?? 0) > 0 ||
    (productTypeCount.value ?? 0) > 0 ||
    (productCategoryCount.value ?? 0) > 0;
  const hasLegacyApi = (legacyApiCallCount.value ?? 0) > 0;
  const hasLegacy = hasLegacyContent || hasLegacyProducts || hasLegacyApi;
  const hasWebsiteBuilder = (websiteBuilderPageCount ?? 0) > 0;
  const migrationTag: TenantStats['migrationTag'] =
    hasWebsiteBuilder && hasLegacy
      ? 'mixed'
      : hasWebsiteBuilder
        ? 'website-builder-only'
        : hasLegacy
          ? 'legacy-only'
          : settingsRead
            ? 'none'
            : 'unknown';

  const appRegistryBytes = estimateRegistryBytes(objectTypesRaw);
  const adoption = Math.min(
    100,
    applications.length * 10 +
      ((totalObjectCount ?? 0) > 0 ? 25 : 0) +
      ((userCount.value ?? 0) > 0 ? 25 : 0) +
      (hasWebsiteBuilder ? 15 : 0),
  );
  const engagement = engagementScore(newestActivityAt);
  let legacyRisk = 0;
  if ((contentManagerItemCount ?? 0) > 0) legacyRisk += 30;
  if ((contentTypeCount.value ?? 0) > 0) legacyRisk += 15;
  if (hasLegacyProducts) legacyRisk += 25;
  if (hasLegacyApi) legacyRisk += 20;
  if ((oldVersionHistoryCount.value ?? 0) > 0) legacyRisk += 10;
  if ((publicToPrivateLeftoverCount ?? 0) > 0) legacyRisk += 10;
  legacyRisk = Math.min(100, legacyRisk);

  let operationalRisk = 0;
  if (appRegistryBytes !== null && appRegistryBytes >= 950 * 1024) operationalRisk += 60;
  else if (appRegistryBytes !== null && appRegistryBytes >= 700 * 1024) operationalRisk += 35;
  if (totalObjectCount === null) operationalRisk += 20;
  if (errors.length > 0) operationalRisk += 20;
  operationalRisk = Math.min(100, operationalRisk);

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
    disabledApplicationCount: applications.filter((app) => app.disabled).length,
    remoteApplicationCount: applications.filter((app) => app.scope === 'remote').length,
    localApplicationCount: applications.filter((app) => app.scope === 'local').length,
    duplicateAppIds,
    appRegistryBytes,
    totalObjectCount,
    objectCounts: {
      omObjects: omObjects.value,
      omPrivateObjects: omPrivateObjects.value,
      pmProducts: pmProducts.value,
    },
    objectStatusCounts: {
      publicEnabled: publicEnabled.value,
      publicDisabled: publicDisabled.value,
      privateEnabled: privateEnabled.value,
      privateDisabled: privateDisabled.value,
    },
    newestObjectCreatedAt,
    newestObjectUpdatedAt,
    userCount: userCount.value,
    newestUserCreatedAt: newestUserCreated.value,
    applications,
    websiteBuilderAppId: websiteBuilderApp?.appId ?? null,
    websiteBuilderPageCount,
    contentManagerItemCount,
    newestContentUpdatedAt: newestContentUpdated.value,
    legacy: {
      contentItemCount: contentManagerItemCount,
      contentTypeCount: contentTypeCount.value,
      productCount: pmProducts.value,
      productTypeCount: productTypeCount.value,
      productCategoryCount: productCategoryCount.value,
      legacyApiCallCount: legacyApiCallCount.value,
      oldVersionHistoryCount: oldVersionHistoryCount.value,
      snapshotCount: snapshotCount.value,
      formTypeCount: formTypeCount.value,
      formSubmissionCount: formSubmissionCount.value,
      aggregatedListCount: aggregatedListCount.value,
      publicToPrivateLeftoverCount,
    },
    migrationTag,
    scores: { adoption, engagement, legacyRisk, operationalRisk },
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
