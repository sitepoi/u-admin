import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import { RefreshTenantStatsButton } from '@/components/statistics/refresh-tenant-stats-button';
import { TenantControlForm } from '@/components/statistics/tenant-control-form';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/client/format';
import { roleCan } from '@/lib/server/auth/roles';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getRelayTenantDetail } from '@/lib/server/relay/relay-client';
import { getTenantStats } from '@/lib/server/statistics/tenant-stats';
import { getTenantControl } from '@/lib/server/statistics/tenant-control';
import type { RelayTenantDetail } from '@/lib/shared/platform-types';

function formatNullableNumber(value: number | null): string {
  return value === null ? '-' : formatNumber(value);
}

export const dynamic = 'force-dynamic';

export default async function ProjectTenantPage({
  params,
}: {
  params: Promise<{ projectId: string; tenantId: string }>;
}) {
  const session = await requireServerSession();
  const { projectId, tenantId } = await params;

  let tenant: RelayTenantDetail | null = null;
  let readError: string | null = null;
  try {
    tenant = await getRelayTenantDetail(tenantId);
  } catch (error) {
    readError = error instanceof Error ? error.message : 'The tenant could not be read.';
  }
  if (!tenant && !readError) notFound();

  const stats = tenant
    ? await getTenantStats(projectId, tenant.tenantId).catch(() => null)
    : null;
  const control = tenant
    ? await getTenantControl(projectId, tenant.tenantId).catch(() => null)
    : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            {projectId} / relay tenant
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {tenant?.companyName ?? tenant?.tenantId ?? tenantId}
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {tenant?.applicationId ?? tenantId}
          </p>
          <p className="mt-2 flex items-center gap-2">
            <Badge tone="neutral">Read-only</Badge>
            {control ? <StatusBadge status={control.status} /> : null}
          </p>
        </div>
        <Link
          href={`/projects/${projectId}/tenants`}
          className={buttonClassName('secondary', 'sm')}
        >
          Back to tenants
        </Link>
      </header>

      {readError ? (
        <Alert tone="danger" title="Could not read the tenant">
          {readError}
        </Alert>
      ) : null}

      {tenant ? (
        <>
          <Card>
            <CardHeader
              title="Relay registry"
              description="Read from the sitepoi-relay applications collection. Nothing is stored in the admin project."
            />
            <CardBody>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Tenant id
                  </dt>
                  <dd className="mt-0.5 font-mono text-slate-900">{tenant.tenantId}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Firebase project
                  </dt>
                  <dd className="mt-0.5 font-mono text-slate-900">{tenant.projectId}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Auth tenant
                  </dt>
                  <dd className="mt-0.5 font-mono text-slate-900">
                    {tenant.authTenant || '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Table extension
                  </dt>
                  <dd className="mt-0.5 font-mono text-slate-900">
                    {tenant.tableExtension || '-'}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Hostnames
                  </dt>
                  <dd className="mt-0.5 break-words text-slate-900">
                    {tenant.hostNames.length > 0 ? tenant.hostNames.join(', ') : '-'}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Tenant control"
              description="Admin-only lifecycle fields. Identity and host mapping come from the relay."
            />
            <CardBody>
              {tenant && roleCan(session.role, 'tenant:write') ? (
                <TenantControlForm
                  projectId={tenant.projectId}
                  applicationId={tenant.applicationId}
                  fallbackDisplayName={tenant.tenantId}
                  initial={control}
                />
              ) : (
                <p className="text-sm text-slate-500">
                  Your role can read this tenant but not edit its control record.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Statistics"
              description="Cached counts. The refresh reads tenant projects and writes only to the admin project."
              actions={
                roleCan(session.role, 'reporting:refresh') && tenant ? (
                  <RefreshTenantStatsButton
                    projectId={tenant.projectId}
                    tenantId={tenant.tenantId}
                    applicationId={tenant.applicationId}
                  />
                ) : null
              }
            />
            <CardBody>
              {!stats ? (
                <EmptyState
                  title="No statistics collected yet"
                  description="Refresh to compute applications, objects, Website Builder pages and legacy Content Manager items."
                />
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500">
                    Computed {formatRelative(stats.computedAt)} ({formatDateTime(stats.computedAt)})
                    in {stats.durationMs} ms. Status: {stats.status}. Migration: {stats.migrationTag}.
                  </p>

                  <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatTile
                      label="Applications"
                      value={formatNumber(stats.applicationCount)}
                      hint={`${stats.enabledApplicationCount} enabled, ${stats.remoteApplicationCount} remote`}
                    />
                    <StatTile
                      label="Total objects"
                      value={formatNullableNumber(stats.totalObjectCount)}
                      hint={`public ${formatNullableNumber(
                        stats.objectCounts.omObjects,
                      )}, private ${formatNullableNumber(
                        stats.objectCounts.omPrivateObjects,
                      )}, products ${formatNullableNumber(stats.objectCounts.pmProducts)}`}
                    />
                    <StatTile
                      label="Website Builder pages"
                      value={formatNullableNumber(stats.websiteBuilderPageCount)}
                      hint={stats.websiteBuilderAppId ?? 'Website Builder app not found'}
                    />
                    <StatTile
                      label="Content Manager items"
                      value={formatNullableNumber(stats.contentManagerItemCount)}
                      hint="Legacy sp_contents, excluding settings-items"
                    />
                  </section>

                  <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatTile
                      label="Users"
                      value={formatNullableNumber(stats.userCount)}
                      hint={
                        stats.newestUserCreatedAt
                          ? `Newest ${formatRelative(stats.newestUserCreatedAt)}`
                          : 'No user records'
                      }
                    />
                    <StatTile
                      label="Adoption score"
                      value={`${stats.scores.adoption}/100`}
                      hint="Apps, objects and users"
                    />
                    <StatTile
                      label="Engagement score"
                      value={`${stats.scores.engagement}/100`}
                      hint={
                        stats.newestObjectUpdatedAt
                          ? `Last object update ${formatRelative(stats.newestObjectUpdatedAt)}`
                          : 'No object activity'
                      }
                    />
                    <StatTile
                      label="Legacy risk"
                      value={`${stats.scores.legacyRisk}/100`}
                      tone={stats.scores.legacyRisk >= 50 ? 'warning' : 'default'}
                      hint="Content Manager, products, legacy API"
                    />
                    <StatTile
                      label="App registry"
                      value={
                        stats.appRegistryBytes === null
                          ? '-'
                          : `${Math.round(stats.appRegistryBytes / 1024)} KiB`
                      }
                      hint="Against the 950 KiB write guard"
                    />
                    <StatTile
                      label="Operational risk"
                      value={`${stats.scores.operationalRisk}/100`}
                      tone={stats.scores.operationalRisk >= 50 ? 'danger' : 'default'}
                      hint="Registry pressure and collection errors"
                    />
                    <StatTile
                      label="Public / private objects"
                      value={`${formatNullableNumber(
                        stats.objectStatusCounts.publicEnabled,
                      )} / ${formatNullableNumber(stats.objectStatusCounts.privateEnabled)}`}
                      hint={`disabled ${formatNullableNumber(
                        stats.objectStatusCounts.publicDisabled,
                      )} / ${formatNullableNumber(stats.objectStatusCounts.privateDisabled)}`}
                    />
                    <StatTile
                      label="Apps local / remote"
                      value={`${stats.localApplicationCount} / ${stats.remoteApplicationCount}`}
                      hint={`${stats.disabledApplicationCount} disabled`}
                    />
                  </section>

                  {stats.errors.length > 0 ? (
                    <Alert tone="warning" title="Partial statistics">
                      <ul className="list-disc space-y-1 pl-4">
                        {stats.errors.map((statsError) => (
                          <li key={statsError}>{statsError}</li>
                        ))}
                      </ul>
                    </Alert>
                  ) : null}

                  {stats.applications.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th scope="col">Application</th>
                            <th scope="col">Scope</th>
                            <th scope="col">State</th>
                            <th scope="col">Objects</th>
                            <th scope="col">Folders</th>
                            <th scope="col">Table</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.applications.map((app) => (
                            <tr key={app.appId}>
                              <td>
                                <span className="block font-medium text-slate-900">{app.name}</span>
                                <span className="font-mono text-xs text-slate-500">
                                  {app.appId}
                                </span>
                              </td>
                              <td className="text-xs text-slate-600">{app.scope}</td>
                              <td className="text-xs text-slate-600">
                                {app.disabled ? 'disabled' : app.saveState || 'enabled'}
                              </td>
                              <td className="text-sm text-slate-900">
                                {formatNullableNumber(app.objectCount)}
                              </td>
                              <td className="text-sm text-slate-900">
                                {formatNullableNumber(app.folderCount)}
                              </td>
                              <td className="font-mono text-xs text-slate-500">
                                {app.objectTable}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <div>
                    <h3 className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
                      Legacy signals
                    </h3>
                    <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        ['Content items', stats.legacy.contentItemCount],
                        ['Content types', stats.legacy.contentTypeCount],
                        ['Legacy products', stats.legacy.productCount],
                        ['Product types', stats.legacy.productTypeCount],
                        ['Product categories', stats.legacy.productCategoryCount],
                        ['Legacy API calls', stats.legacy.legacyApiCallCount],
                        ['Old version history', stats.legacy.oldVersionHistoryCount],
                        ['Current snapshots', stats.legacy.snapshotCount],
                        ['Form types', stats.legacy.formTypeCount],
                        ['Form submissions', stats.legacy.formSubmissionCount],
                        ['Aggregated lists', stats.legacy.aggregatedListCount],
                        ['Public-to-private leftovers', stats.legacy.publicToPrivateLeftoverCount],
                      ].map(([label, value]) => (
                        <div key={String(label)}>
                          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                            {label}
                          </dt>
                          <dd className="mt-0.5 text-slate-900">
                            {formatNullableNumber(value as number | null)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Tenant settings"
              description={`Best effort read from ${tenant.projectId}/settings/website-settings-${tenant.tenantId}.`}
            />
            <CardBody>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Company name
                  </dt>
                  <dd className="mt-0.5 text-slate-900">{tenant.companyName ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Language
                  </dt>
                  <dd className="mt-0.5 text-slate-900">{tenant.language ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Subdomain
                  </dt>
                  <dd className="mt-0.5 text-slate-900">{tenant.subdomain ?? '-'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Settings project name
                  </dt>
                  <dd className="mt-0.5 font-mono text-slate-900">
                    {tenant.databaseProjectName ?? '-'}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-slate-500">
                Missing values mean the settings document could not be read or does not contain
                that field. The relay registry above is still authoritative for the project and
                host mapping.
              </p>
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}
