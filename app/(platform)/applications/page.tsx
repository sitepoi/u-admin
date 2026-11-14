import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import { AnalyzeAllTenantsButton } from '@/components/statistics/analyze-all-tenants-button';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/client/format';
import { roleCan } from '@/lib/server/auth/roles';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getApplicationUsageOverview } from '@/lib/server/statistics/application-usage';
import { getStatisticsOperationMetrics } from '@/lib/server/statistics/operation-metrics';

export const dynamic = 'force-dynamic';

export default async function ApplicationsPage() {
  const session = await requireServerSession();

  const [overviewResult, metricsResult] = await Promise.all([
    getApplicationUsageOverview().then(
      (value) => ({ value, error: null as string | null }),
      (error: unknown) => ({
        value: null,
        error:
          error instanceof Error ? error.message : 'Application usage could not be read.',
      }),
    ),
    getStatisticsOperationMetrics().catch(() => null),
  ]);

  const overview = overviewResult.value;
  const readError = overviewResult.error;
  const operationMetrics = metricsResult;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Applications</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Cross-tenant usage built from cached tenant statistics. Each row is an application id
            from the tenant app registry, grouped across every tenant that has been refreshed.
          </p>
        </div>
        {roleCan(session.role, 'reporting:refresh') ? (
          <AnalyzeAllTenantsButton />
        ) : null}
      </header>

      {readError ? (
        <Alert tone="danger" title="Could not read cached statistics">
          {readError}
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Applications in use"
          description={
            overview
              ? `${overview.applications.length} application(s) across ${overview.computedTenantCount} cached tenant(s). Latest computation ${formatRelative(
                  overview.latestComputedAt ?? '',
                )} (${overview.latestComputedAt ? formatDateTime(overview.latestComputedAt) : '-'}).`
              : 'No cached statistics.'
          }
        />
        <CardBody className="px-0 py-0">
          {readError ? (
            <p className="px-5 py-6 text-sm text-slate-500">
              Check the statistics cache and reload.
            </p>
          ) : !overview || overview.applications.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title="No application usage yet"
                description="Refresh tenant statistics on at least one tenant to populate this list."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Application</th>
                    <th scope="col">Tenants</th>
                    <th scope="col">Enabled</th>
                    <th scope="col">Remote / local</th>
                    <th scope="col">Objects</th>
                    <th scope="col">Folders</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.applications.map((application) => (
                    <tr key={application.appId}>
                      <td>
                        <span className="block font-medium text-slate-900">
                          {application.name}
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          {application.appId}
                        </span>
                      </td>
                      <td className="text-sm text-slate-900">
                        {formatNumber(application.tenantCount)}
                      </td>
                      <td className="text-sm text-slate-900">
                        {formatNumber(application.enabledTenantCount)}
                      </td>
                      <td className="text-sm text-slate-700">
                        {formatNumber(application.remoteTenantCount)} /{' '}
                        {formatNumber(application.localTenantCount)}
                      </td>
                      <td className="text-sm text-slate-900">
                        {formatNumber(application.totalObjectCount)}
                      </td>
                      <td className="text-sm text-slate-900">
                        {formatNumber(application.totalFolderCount)}
                      </td>
                      <td>
                        <Link
                          href={`/applications/${encodeURIComponent(application.appId)}`}
                          className={buttonClassName('secondary', 'sm')}
                        >
                          Open
                        </Link>
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
        Only tenants with cached statistics are included. Refresh a tenant&apos;s statistics to add
        it to these totals, or use <span className="font-medium">Analyze all tenants</span> to fill
        the cache in one pass.
      </p>

      <Card>
        <CardHeader
          title="Firestore usage"
          description="Measured reads and writes for the actions on this page. A count() query is billed as one read per 1,000 matched documents, minimum one read."
        />
        <CardBody className="space-y-5">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="This page"
              value={`${formatNumber((overview?.pageReads ?? 0) + (operationMetrics ? 1 : 0))} reads`}
              hint="Cached statistics documents plus the batch metrics record"
            />
            <StatTile
              label="Last batch request"
              value={
                operationMetrics?.lastRun
                  ? `${formatNumber(operationMetrics.lastRun.reads)} / ${formatNumber(
                      operationMetrics.lastRun.writes,
                    )}`
                  : '-'
              }
              hint={
                operationMetrics?.lastRun
                  ? `${formatNumber(operationMetrics.lastRun.examinedTenants)} tenants examined, ${formatRelative(
                      operationMetrics.lastRun.finishedAt,
                    )}`
                  : 'No batch request recorded yet'
              }
            />
            <StatTile
              label="Lifetime batch cost"
              value={`${formatNumber(operationMetrics?.lifetime.reads ?? 0)} / ${formatNumber(
                operationMetrics?.lifetime.writes ?? 0,
              )}`}
              hint={`${formatNumber(operationMetrics?.lifetime.runs ?? 0)} batch request(s), ${formatNumber(
                operationMetrics?.lifetime.tenantsExamined ?? 0,
              )} tenant(s) examined`}
            />
            <StatTile
              label="Last batch failures"
              value={formatNumber(operationMetrics?.lastRun?.failedTenants ?? 0)}
              hint={
                operationMetrics?.lastRun
                  ? `Finished ${formatDateTime(operationMetrics.lastRun.finishedAt)}`
                  : 'Nothing to report'
              }
            />
          </section>

          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Reads</th>
                  <th scope="col">Writes</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-sm font-medium text-slate-900">Open this page</td>
                  <td className="text-sm text-slate-700">1 per cached tenant + 1</td>
                  <td className="text-sm text-slate-700">0</td>
                  <td className="text-xs text-slate-500">
                    Every cached statistics document is one read.
                  </td>
                </tr>
                <tr>
                  <td className="text-sm font-medium text-slate-900">Open application detail</td>
                  <td className="text-sm text-slate-700">1 per cached tenant</td>
                  <td className="text-sm text-slate-700">0</td>
                  <td className="text-xs text-slate-500">Same cached collection.</td>
                </tr>
                <tr>
                  <td className="text-sm font-medium text-slate-900">Refresh one tenant</td>
                  <td className="text-sm text-slate-700">
                    ≈ 30 + 2 × apps + private apps
                  </td>
                  <td className="text-sm text-slate-700">3</td>
                  <td className="text-xs text-slate-500">
                    Statistics, control record and audit. One read per 1,000 matched count entries
                    is charged on top of the base query count.
                  </td>
                </tr>
                <tr>
                  <td className="text-sm font-medium text-slate-900">Analyze all tenants</td>
                  <td className="text-sm text-slate-700">
                    ≈ 29 + 2 × apps + private apps per tenant
                  </td>
                  <td className="text-sm text-slate-700">2 per tenant + 2 per batch</td>
                  <td className="text-xs text-slate-500">
                    Relay list, metrics and audit are per batch; statistics and control record are
                    per tenant.
                  </td>
                </tr>
                <tr>
                  <td className="text-sm font-medium text-slate-900">Refresh reporting (legacy)</td>
                  <td className="text-sm text-slate-700">≈ 508 per project</td>
                  <td className="text-sm text-slate-700">2 per project + 2</td>
                  <td className="text-xs text-slate-500">
                    Includes a bounded 500-document object sample for the type breakdown.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-500">
            Counts are measured from the actual calls made by this server action. The formulas above
            are estimates for planning; open a tenant or run a batch to see its exact numbers.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
