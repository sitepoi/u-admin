import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import { RefreshReportingButton } from '@/components/reporting/refresh-reporting-button';
import { formatBytes, formatDateTime, formatNumber, formatRelative } from '@/lib/client/format';
import { roleCan } from '@/lib/server/auth/roles';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getPlatformStore } from '@/lib/server/firestore/store-provider';
import { listRelayProjects } from '@/lib/server/relay/relay-client';
import { getReportingSummary } from '@/lib/server/reporting/collector';
import { getPlatformSettings } from '@/lib/server/settings/settings-service';
import { getTenantStatsRollup } from '@/lib/server/statistics/tenant-stats';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await requireServerSession();

  const [reportingSummary, projects, platformSettings, statsRollup] = await Promise.all([
    getReportingSummary(),
    listRelayProjects().catch(() => []),
    getPlatformSettings().catch(() => null),
    getTenantStatsRollup().catch(() => null),
  ]);

  const canRefreshReporting = roleCan(session.role, 'reporting:refresh');
  const canReadAudit = roleCan(session.role, 'audit:read');

  const recentAudit = canReadAudit
    ? await getPlatformStore().listAudit({ limit: 8 }).catch(() => null)
    : null;

  const secretHealth = reportingSummary.secretHealth;
  const snapshot = reportingSummary.platformSnapshot;
  const snapshotMetrics = snapshot?.metrics;
  const platformMetrics =
    snapshotMetrics && 'totals' in snapshotMetrics ? snapshotMetrics : null;

  const totalTenantCount = projects.reduce(
    (total, project) => total + project.tenantCount,
    0,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Platform dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">
            Cross-tenant oversight. Aggregates only; tenant data never leaves its project.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRefreshReporting ? (
            <RefreshReportingButton
              label={snapshot ? 'Refresh reporting' : 'Collect first snapshot'}
            />
          ) : (
            <Badge>Reporting refresh requires owner or admin</Badge>
          )}
        </div>
      </header>

      {reportingSummary.snapshotReadError ? (
        <Alert tone="warning" title="Reporting snapshots unavailable">
          {reportingSummary.snapshotReadError} Create the Firestore indexes from{' '}
          <code className="font-mono text-xs">firestore.indexes.json</code>, then reload.
        </Alert>
      ) : null}

      {platformSettings?.maintenanceNotice ? (
        <Alert tone="warning" title="Platform notice">
          {platformSettings.maintenanceNotice}
        </Alert>
      ) : null}

      <section aria-label="Key platform metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Projects"
          value={formatNumber(projects.length)}
          hint={`${formatNumber(totalTenantCount)} tenant(s) in the relay`}
        />
        <StatTile
          label="Secret delivery failures"
          value={secretHealth ? formatNumber(secretHealth.failedDelivery) : '-'}
          tone={secretHealth && secretHealth.failedDelivery > 0 ? 'danger' : 'default'}
          hint={secretHealth ? 'Reported by the Secret API' : 'Needs a reporting snapshot'}
        />
        <StatTile
          label="Rotation due"
          value={secretHealth ? formatNumber(secretHealth.rotationDue) : '-'}
          tone={secretHealth && secretHealth.rotationDue > 0 ? 'warning' : 'default'}
          hint="First-party keys due or near rotation"
        />
        <StatTile
          label="Pending delivery"
          value={secretHealth ? formatNumber(secretHealth.pendingDelivery) : '-'}
          hint={secretHealth ? `${secretHealth.active} active, ${secretHealth.total} total` : 'Needs a reporting snapshot'}
        />
      </section>

      <section aria-label="Cached tenant statistics" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Tenant statistics</h2>
            <p className="text-xs text-slate-500">
              {statsRollup && statsRollup.tenantCount > 0
                ? `${statsRollup.tenantCount} tenant(s) cached. Latest computation ${formatRelative(
                    statsRollup.latestComputedAt ?? '',
                  )}.`
                : 'No cached statistics yet. Open a tenant and refresh its statistics.'}
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Applications"
            value={statsRollup ? formatNumber(statsRollup.applicationCount) : '-'}
            hint="Installed across cached tenants"
          />
          <StatTile
            label="Objects"
            value={statsRollup ? formatNumber(statsRollup.totalObjectCount) : '-'}
            hint="Public and private object collections"
          />
          <StatTile
            label="Website Builder pages"
            value={statsRollup ? formatNumber(statsRollup.websiteBuilderPageCount) : '-'}
            hint="Website Builder application objects"
          />
          <StatTile
            label="Content Manager items"
            value={statsRollup ? formatNumber(statsRollup.contentManagerItemCount) : '-'}
            hint="Legacy sp_contents, excluding settings-items"
          />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Oversight reporting"
            description="Cached aggregates from the latest platform snapshot."
            actions={
              snapshot ? <StatusBadge status={snapshot.status} label={`snapshot ${snapshot.status}`} /> : null
            }
          />
          <CardBody>
            {!snapshot ? (
              <EmptyState
                title="No reporting snapshot yet"
                description="Run a reporting refresh to collect aggregates from every tenant project. Page loads never query tenant projects directly."
              />
            ) : (
              <div className="space-y-4">
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Period</dt>
                    <dd className="mt-0.5 text-slate-900">{snapshot.period}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Collected</dt>
                    <dd className="mt-0.5 text-slate-900">{formatDateTime(snapshot.collectedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Age</dt>
                    <dd className="mt-0.5 text-slate-900">{formatRelative(snapshot.collectedAt)}</dd>
                  </div>
                </dl>

                {platformMetrics ? (
                  <dl className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Objects</dt>
                      <dd className="mt-0.5 text-lg font-semibold text-slate-900">
                        {formatNumber(platformMetrics.totals.objectCount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                        API requests (month)
                      </dt>
                      <dd className="mt-0.5 text-lg font-semibold text-slate-900">
                        {formatNumber(platformMetrics.totals.apiRequestsThisMonth)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                        First-party requests
                      </dt>
                      <dd className="mt-0.5 text-lg font-semibold text-slate-900">
                        {formatNumber(platformMetrics.totals.firstPartyRequests)}
                        <span className="ml-2 text-xs font-normal text-rose-600">
                          {formatNumber(platformMetrics.totals.firstPartyErrors)} errors
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                        Active users (30d)
                      </dt>
                      <dd className="mt-0.5 text-lg font-semibold text-slate-900">
                        {formatNumber(platformMetrics.totals.activeUsers30d)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Storage</dt>
                      <dd className="mt-0.5 text-lg font-semibold text-slate-900">
                        {formatBytes(platformMetrics.totals.storageBytes)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                        Collection failures
                      </dt>
                      <dd className="mt-0.5 text-lg font-semibold text-slate-900">
                        {formatNumber(platformMetrics.collectionFailures)}
                      </dd>
                    </div>
                  </dl>
                ) : null}

                {snapshot.errors.length > 0 ? (
                  <Alert tone="warning" title="Partial collection">
                    <ul className="list-disc space-y-1 pl-4">
                      {snapshot.errors.map((snapshotError) => (
                        <li key={snapshotError}>{snapshotError}</li>
                      ))}
                    </ul>
                  </Alert>
                ) : null}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Projects in the relay"
            description="Derived from sitepoi-relay applications. No tenant is stored in the admin project."
          />
          <CardBody>
            {projects.length === 0 ? (
              <p className="text-sm text-slate-500">
                No relay applications found, or the relay could not be read.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {projects.slice(0, 6).map((project) => (
                  <li key={project.projectId} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/projects/${project.projectId}/tenants`}
                        className="font-mono text-sm font-medium text-indigo-700 hover:underline"
                      >
                        {project.projectId}
                      </Link>
                      <Badge>{project.tenantCount} tenant(s)</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {project.hostCount} hostname(s)
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <Link href="/projects" className={buttonClassName('secondary', 'sm')}>
                View all projects
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent audit"
          description="Append-only record of sensitive platform actions."
          actions={
            canReadAudit ? (
              <Link href="/audit" className={buttonClassName('secondary', 'sm')}>
                Open audit log
              </Link>
            ) : null
          }
        />
        <CardBody className="px-0 py-0">
          {!canReadAudit ? (
            <p className="px-5 py-6 text-sm text-slate-500">
              Your role cannot read the audit log. Owners, admins and auditors can.
            </p>
          ) : !recentAudit || recentAudit.entries.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No audit records yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Target</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAudit.entries.map((entry) => (
                    <tr key={entry.auditId}>
                      <td className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</td>
                      <td>
                        <span className="block text-slate-900">{entry.actorEmail}</span>
                        <span className="text-xs text-slate-500">{entry.actorRole}</span>
                      </td>
                      <td className="font-mono text-xs">{entry.action}</td>
                      <td className="font-mono text-xs">
                        {entry.targetType}: {entry.targetId}
                      </td>
                      <td>
                        <StatusBadge status={entry.result} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-slate-500">
        This application does not hold the private-key encryption master key and cannot decrypt
        secrets. Reveal, delivery and retirement are delegated to the Secret API.
      </p>
    </div>
  );
}
