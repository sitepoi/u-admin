import { randomUUID } from 'node:crypto';
import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import { formatDate, formatDateTime, formatNumber } from '@/lib/client/format';
import { ApiError } from '@/lib/server/errors';
import { roleCan } from '@/lib/server/auth/roles';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getReportingSummary } from '@/lib/server/reporting/collector';
import { countSecretHealth, listSecretMetadata } from '@/lib/server/secret-api-client/client';
import type { SecretMetadata } from '@/lib/shared/platform-types';

export const dynamic = 'force-dynamic';

export default async function SecretsPage() {
  const session = await requireServerSession();

  if (!roleCan(session.role, 'secret:metadata:read')) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">First-party secrets</h1>
        <Alert tone="warning" title="Not permitted">
          Your role cannot view secret metadata. Owners, admins and operators can.
        </Alert>
      </div>
    );
  }

  const requestId = `page-${randomUUID()}`;

  let secrets: SecretMetadata[] | null = null;
  let loadError: string | null = null;
  try {
    secrets = await listSecretMetadata({ requestId }, undefined, { useCache: false });
  } catch (error) {
    loadError =
      error instanceof ApiError ? error.message : 'The Secret API metadata could not be loaded.';
  }

  const health = secrets ? countSecretHealth(secrets) : null;
  const reportingSummary = await getReportingSummary().catch(() => null);
  const snapshotHealth = reportingSummary?.secretHealth ?? null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">First-party secrets</h1>
          <p className="mt-1 text-sm text-slate-600">
            Metadata only. Private keys are never listed, cached or stored by this application.
          </p>
        </div>
      </header>

      {loadError ? (
        <Alert tone="warning" title="Secret API unavailable">
          {loadError} Secret operations are delegated to the Secret API; the Admin app cannot
          decrypt anything locally.
        </Alert>
      ) : null}

      <section aria-label="Secret health" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Active"
          value={health ? formatNumber(health.active) : snapshotHealth ? formatNumber(snapshotHealth.active) : '-'}
          tone="success"
          hint={health ? `${health.total} secret(s) total` : 'Snapshot value'}
        />
        <StatTile
          label="Pending delivery"
          value={health ? formatNumber(health.pendingDelivery) : snapshotHealth ? formatNumber(snapshotHealth.pendingDelivery) : '-'}
          tone={((health?.pendingDelivery ?? snapshotHealth?.pendingDelivery ?? 0) > 0) ? 'warning' : 'default'}
        />
        <StatTile
          label="Delivery failures"
          value={health ? formatNumber(health.failedDelivery) : snapshotHealth ? formatNumber(snapshotHealth.failedDelivery) : '-'}
          tone={((health?.failedDelivery ?? snapshotHealth?.failedDelivery ?? 0) > 0) ? 'danger' : 'default'}
        />
        <StatTile
          label="Rotation due"
          value={health ? formatNumber(health.rotationDue) : snapshotHealth ? formatNumber(snapshotHealth.rotationDue) : '-'}
          tone={((health?.rotationDue ?? snapshotHealth?.rotationDue ?? 0) > 0) ? 'warning' : 'default'}
        />
      </section>

      <Card>
        <CardHeader
          title="Secret metadata"
          description="Global view across every tenant, as returned by the Secret API."
        />
        <CardBody className="px-0 py-0">
          {!secrets ? (
            <div className="px-5 py-6">
              <EmptyState
                title="Metadata unavailable"
                description="The Secret API did not respond. Refresh or check the service health."
              />
            </div>
          ) : secrets.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title="No first-party secrets"
                description="Secrets are created during CMS enrollment."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Secret</th>
                    <th scope="col">Tenant</th>
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
                      <td className="font-mono text-xs">
                        <Link
                          href={`/tenants/${encodeURIComponent(secret.tenantId)}`}
                          className="text-indigo-700 hover:underline"
                        >
                          {secret.tenantId}
                        </Link>
                      </td>
                      <td className="font-mono text-xs">{secret.kid ?? '-'}</td>
                      <td>
                        <StatusBadge status={secret.status} />
                      </td>
                      <td className="text-xs">
                        <span className="block">{secret.deliveryMode ?? '-'}</span>
                        <span className="block text-slate-500">{secret.deliveryStatus ?? '-'}</span>
                        {secret.lastDeliveryError ? (
                          <span className="block max-w-xs truncate text-rose-600" title={secret.lastDeliveryError}>
                            {secret.lastDeliveryError}
                          </span>
                        ) : null}
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

      <p className="text-xs text-slate-500">
        Reveal, delivery and retirement are proxied to the Secret API server-to-server. The browser
        never calls the Secret API directly.
      </p>
    </div>
  );
}
