import 'server-only';

import { getPlatformFirestore } from '@/lib/server/firebase/admin';
import { TENANT_STATS_COLLECTION } from '@/lib/server/statistics/tenant-stats';
import type {
  ApplicationUsageDetail,
  ApplicationUsageOverview,
  ApplicationUsageSummary,
  ApplicationUsageTenant,
  TenantStats,
} from '@/lib/shared/platform-types';

interface ApplicationAccumulator {
  summary: ApplicationUsageSummary;
  tenants: Map<string, ApplicationUsageTenant>;
}

function buildUsageAccumulators(statistics: TenantStats[]): {
  applications: Map<string, ApplicationAccumulator>;
  latestComputedAt: string | null;
} {
  const applications = new Map<string, ApplicationAccumulator>();
  let latestComputedAt: string | null = null;

  for (const stats of statistics) {
    if (stats.computedAt && (!latestComputedAt || stats.computedAt > latestComputedAt)) {
      latestComputedAt = stats.computedAt;
    }

    const seenInTenant = new Set<string>();
    for (const app of stats.applications ?? []) {
      if (seenInTenant.has(app.appId)) continue;
      seenInTenant.add(app.appId);

      const accumulator = applications.get(app.appId) ?? {
        summary: {
          appId: app.appId,
          name: app.name || app.appId,
          tenantCount: 0,
          enabledTenantCount: 0,
          remoteTenantCount: 0,
          localTenantCount: 0,
          totalObjectCount: 0,
          totalFolderCount: 0,
        },
        tenants: new Map<string, ApplicationUsageTenant>(),
      };

      accumulator.summary.tenantCount += 1;
      if (!app.disabled) accumulator.summary.enabledTenantCount += 1;
      if (app.scope === 'remote') accumulator.summary.remoteTenantCount += 1;
      else accumulator.summary.localTenantCount += 1;
      accumulator.summary.totalObjectCount += app.objectCount ?? 0;
      accumulator.summary.totalFolderCount += app.folderCount ?? 0;

      accumulator.tenants.set(`${stats.projectId}__${stats.tenantId}`, {
        projectId: stats.projectId,
        tenantId: stats.tenantId,
        applicationId: stats.applicationId,
        disabled: app.disabled,
        scope: app.scope,
        objectCount: app.objectCount ?? null,
        folderCount: app.folderCount ?? null,
      });

      applications.set(app.appId, accumulator);
    }
  }

  return { applications, latestComputedAt };
}

async function readCachedStatistics(): Promise<{
  statistics: TenantStats[];
  documentReads: number;
}> {
  const snapshot = await getPlatformFirestore()
    .collection(TENANT_STATS_COLLECTION)
    .limit(1000)
    .get();
  return {
    statistics: snapshot.docs.map((document) => document.data() as TenantStats),
    documentReads: snapshot.size,
  };
}

export async function getApplicationUsageOverview(): Promise<ApplicationUsageOverview> {
  const { statistics, documentReads } = await readCachedStatistics();
  const { applications, latestComputedAt } = buildUsageAccumulators(statistics);

  return {
    applications: [...applications.values()]
      .map((entry) => entry.summary)
      .sort(
        (left, right) =>
          right.tenantCount - left.tenantCount || left.appId.localeCompare(right.appId),
      ),
    computedTenantCount: statistics.length,
    latestComputedAt,
    pageReads: documentReads,
  };
}

export async function getApplicationUsageDetail(
  appId: string,
): Promise<ApplicationUsageDetail | null> {
  const { statistics, documentReads } = await readCachedStatistics();
  const { applications } = buildUsageAccumulators(statistics);
  const accumulator = applications.get(appId);
  if (!accumulator) return null;

  return {
    ...accumulator.summary,
    tenants: [...accumulator.tenants.values()].sort(
      (left, right) =>
        left.projectId.localeCompare(right.projectId) ||
        left.tenantId.localeCompare(right.tenantId),
    ),
    pageReads: documentReads,
  };
}
