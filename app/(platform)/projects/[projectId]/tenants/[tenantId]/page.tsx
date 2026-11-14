import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getRelayTenantDetail } from '@/lib/server/relay/relay-client';
import type { RelayTenantDetail } from '@/lib/shared/platform-types';

export const dynamic = 'force-dynamic';

export default async function ProjectTenantPage({
  params,
}: {
  params: Promise<{ projectId: string; tenantId: string }>;
}) {
  await requireServerSession();
  const { projectId, tenantId } = await params;

  let tenant: RelayTenantDetail | null = null;
  let readError: string | null = null;
  try {
    tenant = await getRelayTenantDetail(tenantId);
  } catch (error) {
    readError = error instanceof Error ? error.message : 'The tenant could not be read.';
  }
  if (!tenant && !readError) notFound();

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
          <p className="mt-2">
            <Badge tone="neutral">Read-only</Badge>
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
