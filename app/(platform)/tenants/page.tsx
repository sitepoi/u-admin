import Link from 'next/link';

import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, EmptyState } from '@/components/ui/card';
import { TenantCreateDialog } from '@/components/tenants/tenant-create-dialog';
import { buttonClassName } from '@/components/ui/button';
import { formatDateTime } from '@/lib/client/format';
import { TENANT_STATUSES, type TenantStatus } from '@/lib/shared/constants';
import { roleCan } from '@/lib/server/auth/roles';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { listTenants, toTenantListItem } from '@/lib/server/tenants/tenant-service';

export const dynamic = 'force-dynamic';

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function parseStatus(rawStatus: string): TenantStatus | 'all' {
  return (TENANT_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as TenantStatus)
    : 'all';
}

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireServerSession();
  const resolvedSearchParams = await searchParams;

  const search = firstValue(resolvedSearchParams.search).trim();
  const status = parseStatus(firstValue(resolvedSearchParams.status) || 'all');

  const tenants = await listTenants({ search, status });
  const tenantItems = tenants.map(toTenantListItem);
  const canCreateTenant = roleCan(session.role, 'tenant:write');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Tenants</h1>
          <p className="mt-1 text-sm text-slate-600">
            Tenant metadata, domains and provisioning state. Records are archived, never deleted.
          </p>
        </div>
        {canCreateTenant ? <TenantCreateDialog /> : null}
      </header>

      <Card>
        <CardHeader
          title="Search and filter"
          description={`${tenantItems.length} tenant record(s) matched.`}
        />
        <CardBody>
          <form method="get" action="/tenants" className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="tenant-search" className="block text-sm font-medium text-slate-800">
                Search
              </label>
              <input
                id="tenant-search"
                name="search"
                defaultValue={search}
                placeholder="Tenant id, name or host"
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-slate-300 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600"
              />
            </div>
            <div>
              <label htmlFor="tenant-status" className="block text-sm font-medium text-slate-800">
                Status
              </label>
              <select
                id="tenant-status"
                name="status"
                defaultValue={status}
                className="mt-1 block rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-600"
              >
                <option value="all">All statuses</option>
                {TENANT_STATUSES.map((tenantStatus) => (
                  <option key={tenantStatus} value={tenantStatus}>
                    {tenantStatus}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={buttonClassName('primary', 'md')}>
              Apply filters
            </button>
            <Link href="/tenants" className={buttonClassName('ghost', 'md')}>
              Reset
            </Link>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Tenant records" description="Newest first." />
        <CardBody className="px-0 py-0">
          {tenantItems.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title="No tenants match this filter"
                description="Adjust the search or create a new tenant record."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Tenant</th>
                    <th scope="col">Status</th>
                    <th scope="col">Hosts</th>
                    <th scope="col">Delivery</th>
                    <th scope="col">First party</th>
                    <th scope="col">Updated</th>
                    <th scope="col">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tenantItems.map((tenant) => (
                    <tr key={tenant.tenantId}>
                      <td>
                        <Link
                          href={`/tenants/${tenant.tenantId}`}
                          className="font-medium text-indigo-700 hover:underline"
                        >
                          {tenant.displayName}
                        </Link>
                        <span className="block font-mono text-xs text-slate-500">
                          {tenant.tenantId}
                        </span>
                        {tenant.lastError ? (
                          <span className="mt-1 block max-w-xs truncate text-xs text-rose-600" title={tenant.lastError}>
                            {tenant.lastError}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <StatusBadge status={tenant.status} />
                        {tenant.provisioningStatus !== 'idle' ? (
                          <span className="mt-1 block text-xs text-slate-500">
                            provisioning: {tenant.provisioningStatus}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-xs">
                        <span className="block font-mono text-slate-700">{tenant.cmsHost || '-'}</span>
                        <span className="block font-mono text-slate-500">
                          {tenant.publicwebsiteHost || '-'}
                        </span>
                        {tenant.primaryDomain ? (
                          <span className="block text-slate-500">{tenant.primaryDomain}</span>
                        ) : null}
                      </td>
                      <td className="text-xs">
                        <span className="block text-slate-700">{tenant.deliveryMode}</span>
                      </td>
                      <td>
                        <StatusBadge status={tenant.firstPartyStatus} />
                      </td>
                      <td className="whitespace-nowrap text-xs text-slate-500">
                        {formatDateTime(tenant.updatedAt)}
                      </td>
                      <td>
                        <Link
                          href={`/tenants/${tenant.tenantId}`}
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
    </div>
  );
}
