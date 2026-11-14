import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, StatTile } from '@/components/ui/card';
import { formatNumber } from '@/lib/client/format';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getApplicationUsageDetail } from '@/lib/server/statistics/application-usage';
import type { ApplicationUsageDetail } from '@/lib/shared/platform-types';

export const dynamic = 'force-dynamic';

export default async function ApplicationUsagePage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  await requireServerSession();
  const { appId } = await params;

  let detail: ApplicationUsageDetail | null = null;
  let readError: string | null = null;
  try {
    detail = await getApplicationUsageDetail(appId);
  } catch (error) {
    readError = error instanceof Error ? error.message : 'Application usage could not be read.';
  }
  if (!detail && !readError) notFound();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Application usage
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            {detail?.name ?? appId}
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{appId}</p>
        </div>
        <Link href="/applications" className={buttonClassName('secondary', 'sm')}>
          Back to applications
        </Link>
      </header>

      {readError ? (
        <Alert tone="danger" title="Could not read application usage">
          {readError}
        </Alert>
      ) : null}

      {detail ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile
              label="Tenants using it"
              value={formatNumber(detail.tenantCount)}
              hint={`${formatNumber(detail.enabledTenantCount)} with the app enabled`}
            />
            <StatTile
              label="Remote / local"
              value={`${formatNumber(detail.remoteTenantCount)} / ${formatNumber(
                detail.localTenantCount,
              )}`}
              hint="Store-installed versus tenant-authored"
            />
            <StatTile
              label="Objects / folders"
              value={`${formatNumber(detail.totalObjectCount)} / ${formatNumber(
                detail.totalFolderCount,
              )}`}
              hint="Across the tenants below"
            />
          </section>

          <Card>
            <CardHeader
              title="Tenants using this application"
              description={`${detail.tenants.length} tenant(s) in the cached statistics.`}
            />
            <CardBody className="px-0 py-0">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Project</th>
                      <th scope="col">Tenant</th>
                      <th scope="col">Scope</th>
                      <th scope="col">State</th>
                      <th scope="col">Objects</th>
                      <th scope="col">Folders</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.tenants.map((tenant) => (
                      <tr key={`${tenant.projectId}__${tenant.tenantId}`}>
                        <td className="font-mono text-xs text-slate-700">{tenant.projectId}</td>
                        <td>
                          <span className="block font-medium text-slate-900">
                            {tenant.tenantId}
                          </span>
                          <span className="font-mono text-xs text-slate-500">
                            {tenant.applicationId}
                          </span>
                        </td>
                        <td className="text-xs text-slate-600">{tenant.scope}</td>
                        <td>
                          <StatusBadge status={tenant.disabled ? 'disabled' : 'active'} />
                        </td>
                        <td className="text-sm text-slate-900">
                          {tenant.objectCount === null ? '-' : formatNumber(tenant.objectCount)}
                        </td>
                        <td className="text-sm text-slate-900">
                          {tenant.folderCount === null ? '-' : formatNumber(tenant.folderCount)}
                        </td>
                        <td>
                          <Link
                            href={`/projects/${tenant.projectId}/tenants/${encodeURIComponent(
                              tenant.applicationId,
                            )}`}
                            className={buttonClassName('secondary', 'sm')}
                          >
                            Open tenant
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}
