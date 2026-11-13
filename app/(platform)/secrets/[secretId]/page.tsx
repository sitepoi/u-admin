import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/card';
import { DeliverSecretForm } from '@/components/secrets/deliver-secret-form';
import { RetireSecretDialog } from '@/components/secrets/retire-secret-dialog';
import { RevealSecretDialog } from '@/components/secrets/reveal-secret-dialog';
import { formatDate, formatDateTime } from '@/lib/client/format';
import { ApiError } from '@/lib/server/errors';
import { roleCan } from '@/lib/server/auth/roles';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getSecretMetadata } from '@/lib/server/secret-api-client/client';
import type { SecretMetadata } from '@/lib/shared/platform-types';

export const dynamic = 'force-dynamic';

export default async function SecretDetailPage({
  params,
}: {
  params: Promise<{ secretId: string }>;
}) {
  const session = await requireServerSession();
  const { secretId } = await params;

  if (!roleCan(session.role, 'secret:metadata:read')) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Secret</h1>
        <Alert tone="warning" title="Not permitted">
          Your role cannot view secret metadata.
        </Alert>
      </div>
    );
  }

  let secret: SecretMetadata;
  try {
    secret = await getSecretMetadata({ requestId: `page-${randomUUID()}` }, secretId);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'SECRET_NOT_FOUND') {
      notFound();
    }
    return (
      <div className="space-y-6">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
          <Link href="/secrets" className="hover:text-slate-700 hover:underline">
            Secrets
          </Link>
        </nav>
        <h1 className="text-2xl font-semibold text-slate-900">Secret</h1>
        <Alert tone="warning" title="Secret API unavailable">
          {error instanceof ApiError
            ? error.message
            : 'The secret metadata could not be loaded.'}{' '}
          The Admin app never falls back to local decryption.
        </Alert>
      </div>
    );
  }

  const canReveal = roleCan(session.role, 'secret:reveal');
  const canDeliver = roleCan(session.role, 'secret:deliver');
  const canRetire = roleCan(session.role, 'secret:retire');

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <Link href="/secrets" className="hover:text-slate-700 hover:underline">
          Secrets
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span className="font-mono text-slate-700">{secret.secretId}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold text-slate-900">{secret.secretId}</h1>
            <StatusBadge status={secret.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Tenant{' '}
            <Link
              href={`/tenants/${encodeURIComponent(secret.tenantId)}`}
              className="font-mono text-indigo-700 hover:underline"
            >
              {secret.tenantId}
            </Link>
          </p>
        </div>
        <Link href="/secrets" className={buttonClassName('secondary', 'sm')}>
          Back to secrets
        </Link>
      </header>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Metadata"
            description="Returned by the Secret API. This record never contains key material."
          />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'App id', value: secret.appId, mono: true },
                { label: 'Key id (kid)', value: secret.kid ?? '', mono: true },
                { label: 'Algorithm', value: secret.algorithm ?? '', mono: true },
                { label: 'Version', value: secret.version === null ? '' : String(secret.version) },
                { label: 'Status', value: <StatusBadge status={secret.status} /> },
                { label: 'Raw status', value: secret.rawStatus ?? '', mono: true },
                { label: 'Delivery mode', value: secret.deliveryMode ?? '' },
                { label: 'Delivery status', value: secret.deliveryStatus ?? '' },
                { label: 'Fingerprint', value: secret.fingerprint ?? '', mono: true },
                { label: 'Last delivery error', value: secret.lastDeliveryError ?? '' },
                { label: 'Created', value: formatDateTime(secret.createdAt) },
                { label: 'Updated', value: formatDateTime(secret.updatedAt) },
                { label: 'Rotation due', value: secret.rotationDueAt ? formatDate(secret.rotationDueAt) : '' },
                { label: 'Last delivered', value: formatDateTime(secret.lastDeliveredAt) },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Actions" description="Each action is audited and delegated to the Secret API." />
          <CardBody className="space-y-4">
            {canReveal ? (
              <div>
                <p className="text-sm font-medium text-slate-800">Reveal</p>
                <p className="mt-0.5 mb-2 text-xs text-slate-500">
                  Owner-only. Requires MFA and a fresh authentication.
                </p>
                <RevealSecretDialog
                  secretId={secret.secretId}
                  sessionEmail={session.email}
                  e2eRole={session.role}
                />
              </div>
            ) : null}

            {canDeliver ? (
              <div className="border-t border-slate-100 pt-4">
                <p className="text-sm font-medium text-slate-800">Deliver</p>
                <p className="mt-0.5 mb-2 text-xs text-slate-500">
                  Owner or admin. The Secret API owns delivery status.
                </p>
                <DeliverSecretForm
                  secretId={secret.secretId}
                  sessionEmail={session.email}
                  defaultMode={secret.deliveryMode ?? 'manual'}
                  e2eRole={session.role}
                />
              </div>
            ) : null}

            {canRetire ? (
              <div className="border-t border-slate-100 pt-4">
                <p className="text-sm font-medium text-slate-800">Retire</p>
                <p className="mt-0.5 mb-2 text-xs text-slate-500">
                  Owner-only. The Secret API verifies owner and MFA.
                </p>
                <RetireSecretDialog
                  secretId={secret.secretId}
                  sessionEmail={session.email}
                  e2eRole={session.role}
                />
              </div>
            ) : null}

            {!canReveal && !canDeliver && !canRetire ? (
              <p className="text-sm text-slate-500">
                Your role cannot perform secret actions. Metadata is read-only.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Alert tone="info" title="Security boundary">
        The Admin app does not hold the private-key encryption master key and stores no
        ciphertext. Every reveal is performed by the Secret API with the forwarded
        <code className="font-mono text-xs"> actorIdToken</code>, and the response is returned with
        <code className="font-mono text-xs"> Cache-Control: no-store</code>.
      </Alert>
    </div>
  );
}
