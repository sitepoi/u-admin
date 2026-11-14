import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState } from '@/components/ui/card';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/client/format';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getApplicationUsageOverview } from '@/lib/server/statistics/application-usage';
import type { ApplicationUsageOverview } from '@/lib/shared/platform-types';

export const dynamic = 'force-dynamic';

export default async function ApplicationsPage() {
  await requireServerSession();

  let overview: ApplicationUsageOverview | null = null;
  let readError: string | null = null;
  try {
    overview = await getApplicationUsageOverview();
  } catch (error) {
    readError = error instanceof Error ? error.message : 'Application usage could not be read.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Applications</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Cross-tenant usage built from cached tenant statistics. Each row is an application id
          from the tenant app registry, grouped across every tenant that has been refreshed.
        </p>
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
        it to these totals.
      </p>
    </div>
  );
}
