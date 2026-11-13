import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList, EmptyState, StatTile } from '@/components/ui/card';
import { TenantActions } from '@/components/tenants/tenant-actions';
import { TenantEditForm } from '@/components/tenants/tenant-edit-form';
import { formatDate, formatDateTime, formatNumber, formatRelative } from '@/lib/client/format';
import { ApiError } from '@/lib/server/errors';
import { roleCan } from '@/lib/server/auth/roles';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getPlatformStore } from '@/lib/server/firestore/store-provider';
import { getReportingSummary, getTenantSnapshots } from '@/lib/server/reporting/collector';
import { listSecretMetadata } from '@/lib/server/secret-api-client/client';
import { getTenantOrThrow } from '@/lib/server/tenants/tenant-service';
import type { SecretMetadata } from '@/lib/shared/platform-types';

export const dynamic = 'force-dynamic';

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const session = await requireServerSession();
  const { tenantId } = await params;

  const tenant = await getTenantOrThrow(tenantId).catch(() => notFound());

  const canReadSecrets = roleCan(session.role, 'secret:metadata:read');
  const canReadAudit = roleCan(session.role, 'audit:read');
  const canWriteTenant = roleCan(session.role, 'tenant:write');
  const canProvisionTenant = roleCan(session.role, 'tenant:provision');
  const canArchiveTenant = roleCan(session.role, 'tenant:archive');

  const requestId = `page-${randomUUID()}`;

  const [snapshots, secretsResult, auditEntries, platformSummary] = await Promise.all([
    getTenantSnapshots(tenant.tenantId).catch(() => []),
    canReadSecrets
      ? listSecretMetadata({ requestId }, tenant.tenantId, { useCache: false })
          .then((secrets) => ({ ok: true as const, secrets }))
          .catch((error: unknown) => ({
            ok: false as const,
            message:
              error instanceof ApiError
                ? error.message
                : 'The Secret API metadata could not be loaded.',
          }))
      : Promise.resolve(null),
    canReadAudit
      ? getPlatformStore()
          .listAudit({ tenantId: tenant.tenantId, limit: 10 })
          .then((page) => page.entries)
          .catch(() => null)
      : Promise.resolve(null),
    getReportingSummary().catch(() => null),
  ]);

  const latestSnapshot = snapshots[0];
  const latestMetrics =
    latestSnapshot && 'objectCountTotal' in latestSnapshot.metrics
      ? latestSnapshot.metrics
      : null;

  const secrets: SecretMetadata[] = secretsResult?.ok ? secretsResult.secrets : [];
  const totalSecretCount = secrets.length;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <Link href="/tenants" className="hover:text-slate-700 hover:underline">
          Tenants
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span className="text-slate-700">{tenant.displayName}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-900">{tenant.displayName}</h1>
            <StatusBadge status={tenant.status} />
          </div>
          <p className="mt-1 font-mono text-sm text-slate-500">{tenant.tenantId}</p>
          <p className="mt-1 text-xs text-slate-500">
            Created {formatDateTime(tenant.createdAt)} by {tenant.createdBy} · Updated{' '}
            {formatRelative(tenant.updatedAt)}
          </p>
        </div>
        <TenantActions
          tenantId={tenant.tenantId}
          status={tenant.status}
          canProvision={canProvisionTenant}
          canArchive={canArchiveTenant}
        />
      </header>

      <nav aria-label="Sections" className="flex flex-wrap gap-2 text-sm">
        {[
          ['overview', 'Overview'],
          ['domains', 'Domains'],
          ['deployment', 'Deployment'],
          ['secrets', 'First-party secrets'],
          ['reporting', 'Reporting'],
          ['audit', 'Audit'],
        ].map(([anchorId, label]) => (
          <a
            key={anchorId}
            href={`#${anchorId}`}
            className="rounded-md px-2.5 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            {label}
          </a>
        ))}
      </nav>

      <section aria-label="Tenant summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Provisioning"
          value={tenant.provisioning.status}
          tone={
            tenant.provisioning.status === 'failed'
              ? 'danger'
              : tenant.provisioning.status === 'succeeded'
                ? 'success'
                : 'default'
          }
          hint={tenant.provisioning.attemptId ? `attempt ${tenant.provisioning.attemptId.slice(0, 8)}` : 'No attempt yet'}
        />
        <StatTile
          label="First-party secrets"
          value={secretsResult?.ok ? formatNumber(totalSecretCount) : '-'}
          hint={secretsResult?.ok ? `${tenant.firstPartyStatus}` : 'Metadata unavailable'}
        />
        <StatTile
          label="Objects"
          value={latestMetrics ? formatNumber(latestMetrics.objectCountTotal) : '-'}
          hint={latestSnapshot ? `snapshot ${latestSnapshot.period}` : 'No snapshot yet'}
        />
        <StatTile
          label="Last reporting refresh"
          value={tenant.reporting.lastRefreshAt ? formatRelative(tenant.reporting.lastRefreshAt) : 'never'}
          hint={platformSummary?.lastRefreshAt ? `platform ${formatRelative(platformSummary.lastRefreshAt)}` : undefined}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Overview" description="Tenant identity and delivery configuration." />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Tenant id', value: tenant.tenantId, mono: true },
                { label: 'Status', value: <StatusBadge status={tenant.status} /> },
                { label: 'CMS project id', value: tenant.cmsProjectId, mono: true },
                { label: 'First-party app id', value: tenant.firstPartyAppId, mono: true },
                { label: 'First-party status', value: <StatusBadge status={tenant.firstPartyStatus} /> },
                { label: 'Delivery mode', value: tenant.deliveryMode },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Domains" description="Hosts that the tenant surfaces are served on." />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'CMS host', value: tenant.cmsHost, mono: true },
                { label: 'Public website host', value: tenant.publicwebsiteHost, mono: true },
                { label: 'Primary custom domain', value: tenant.primaryDomain, mono: true },
                {
                  label: 'Additional custom domains',
                  value:
                    tenant.customDomains.length > 0 ? (
                      <ul className="space-y-0.5">
                        {tenant.customDomains.map((customDomain) => (
                          <li key={customDomain} className="font-mono text-xs">
                            {customDomain}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      ''
                    ),
                },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <Card id="deployment">
        <CardHeader
          title="Deployment and provisioning"
          description="CMS system API orchestration. The Admin app never duplicates CMS tenant creation logic."
        />
        <CardBody className="space-y-4">
          {tenant.provisioning.lastError ? (
            <Alert tone="danger" title="Last provisioning error">
              {tenant.provisioning.lastError}
            </Alert>
          ) : null}
          {tenant.reporting.lastError ? (
            <Alert tone="warning" title="Last reporting error">
              {tenant.reporting.lastError}
            </Alert>
          ) : null}

          <DescriptionList
            items={[
              { label: 'Provisioning status', value: <StatusBadge status={tenant.provisioning.status} /> },
              { label: 'Attempt id', value: tenant.provisioning.attemptId ?? '', mono: true },
              { label: 'Started', value: formatDateTime(tenant.provisioning.startedAt) },
              { label: 'Finished', value: formatDateTime(tenant.provisioning.finishedAt) },
              { label: 'Vercel project id', value: tenant.publicwebsiteVercelProjectId || '', mono: true },
              { label: 'Last refresh', value: formatDateTime(tenant.reporting.lastRefreshAt) },
            ]}
          />

          {canWriteTenant ? <TenantEditForm tenant={tenant} /> : null}
        </CardBody>
      </Card>

      <Card id="secrets">
        <CardHeader
          title="First-party secrets"
          description="Metadata only. Private keys are never displayed in lists and never stored by this application."
          actions={
            canReadSecrets ? (
              <Link href="/secrets" className={buttonClassName('secondary', 'sm')}>
                Global secret health
              </Link>
            ) : null
          }
        />
        <CardBody className="px-0 py-0">
          {!canReadSecrets ? (
            <p className="px-5 py-6 text-sm text-slate-500">
              Your role cannot view secret metadata. Owners, admins and operators can.
            </p>
          ) : secretsResult && !secretsResult.ok ? (
            <div className="px-5 py-6">
              <Alert tone="warning" title="Secret API unavailable">
                {secretsResult.message} The Admin app never falls back to local decryption.
              </Alert>
            </div>
          ) : secrets.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title="No first-party secrets recorded"
                description="Enrollment happens in the CMS during provisioning. Use the Secret API to inspect enrollment state."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Secret</th>
                    <th scope="col">Kid</th>
                    <th scope="col">Status</th>
                    <th scope="col">Delivery</th>
                    <th scope="col">Rotation due</th>
                    <th scope="col">Updated</th>
                    <th scope="col">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {secrets.map((secret) => (
                    <tr key={secret.secretId}>
                      <td className="font-mono text-xs">{secret.secretId}</td>
                      <td className="font-mono text-xs">{secret.kid ?? '-'}</td>
                      <td>
                        <StatusBadge status={secret.status} />
                      </td>
                      <td className="text-xs">
                        <span className="block">{secret.deliveryMode ?? '-'}</span>
                        <span className="block text-slate-500">{secret.deliveryStatus ?? '-'}</span>
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {secret.rotationDueAt ? formatDate(secret.rotationDueAt) : '-'}
                      </td>
                      <td className="whitespace-nowrap text-xs text-slate-500">
                        {formatDateTime(secret.updatedAt)}
                      </td>
                      <td>
                        <Link
                          href={`/secrets/${encodeURIComponent(secret.secretId)}`}
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

      <Card id="reporting">
        <CardHeader
          title="Reporting snapshots"
          description="Aggregates only. Raw tenant objects are never copied into the platform database."
        />
        <CardBody className="px-0 py-0">
          {snapshots.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title="No snapshot for this tenant"
                description="Run a platform reporting refresh to collect aggregates."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Period</th>
                    <th scope="col">Status</th>
                    <th scope="col">Objects</th>
                    <th scope="col">API requests</th>
                    <th scope="col">First party</th>
                    <th scope="col">Active users</th>
                    <th scope="col">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snapshot) => {
                    const metrics =
                      'objectCountTotal' in snapshot.metrics ? snapshot.metrics : null;
                    return (
                      <tr key={snapshot.snapshotId}>
                        <td className="whitespace-nowrap font-mono text-xs">{snapshot.period}</td>
                        <td>
                          <StatusBadge status={snapshot.status} />
                        </td>
                        <td className="text-xs">
                          <span className="block">{formatNumber(metrics?.objectCountTotal)}</span>
                          {metrics && Object.keys(metrics.objectCountByType).length > 0 ? (
                            <span className="block text-slate-500">
                              {Object.entries(metrics.objectCountByType)
                                .slice(0, 3)
                                .map(([typeName, typeCount]) => `${typeName}: ${typeCount}`)
                                .join(', ')}
                            </span>
                          ) : null}
                        </td>
                        <td className="text-xs">
                          {metrics?.apiRequestsThisMonth
                            ? `${formatNumber(metrics.apiRequestsThisMonth.total)} (v1 ${formatNumber(metrics.apiRequestsThisMonth.v1)}, v2 ${formatNumber(metrics.apiRequestsThisMonth.v2)})`
                            : '-'}
                        </td>
                        <td className="text-xs">
                          {metrics?.firstParty
                            ? `${formatNumber(metrics.firstParty.requests)} / ${formatNumber(metrics.firstParty.errors)} errors`
                            : '-'}
                        </td>
                        <td className="text-xs">{formatNumber(metrics?.activeUsers30d)}</td>
                        <td className="whitespace-nowrap text-xs text-slate-500">
                          {formatDateTime(snapshot.collectedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card id="audit">
        <CardHeader
          title="Tenant audit trail"
          description="Every sensitive action scoped to this tenant."
          actions={
            canReadAudit ? (
              <Link
                href={`/audit?tenantId=${encodeURIComponent(tenant.tenantId)}`}
                className={buttonClassName('secondary', 'sm')}
              >
                Open in audit log
              </Link>
            ) : null
          }
        />
        <CardBody className="px-0 py-0">
          {!canReadAudit ? (
            <p className="px-5 py-6 text-sm text-slate-500">
              Your role cannot read the audit log.
            </p>
          ) : !auditEntries || auditEntries.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No audit entries for this tenant yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Result</th>
                    <th scope="col">Request</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((entry) => (
                    <tr key={entry.auditId}>
                      <td className="whitespace-nowrap text-xs">{formatDateTime(entry.createdAt)}</td>
                      <td className="text-xs">
                        <span className="block">{entry.actorEmail}</span>
                        <span className="block text-slate-500">{entry.actorRole}</span>
                      </td>
                      <td className="font-mono text-xs">{entry.action}</td>
                      <td>
                        <StatusBadge status={entry.result} />
                      </td>
                      <td className="font-mono text-xs text-slate-500">{entry.requestId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-slate-500">
        <Badge tone="neutral">No tenant boundary</Badge>{' '}
        This view aggregates metadata across the platform. Secret material remains inside the Secret
        API.
      </p>
    </div>
  );
}
