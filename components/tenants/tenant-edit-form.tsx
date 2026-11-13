'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectInput, TextInput } from '@/components/ui/form';
import { apiRequest, ApiClientError } from '@/lib/client/api';
import type { DeliveryMode } from '@/lib/shared/constants';
import type { TenantDetail } from '@/lib/shared/platform-types';

export function TenantEditForm({ tenant }: { tenant: TenantDetail }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState(tenant.displayName);
  const [cmsProjectId, setCmsProjectId] = useState(tenant.cmsProjectId);
  const [cmsHost, setCmsHost] = useState(tenant.cmsHost);
  const [publicwebsiteHost, setPublicwebsiteHost] = useState(tenant.publicwebsiteHost);
  const [primaryDomain, setPrimaryDomain] = useState(tenant.primaryDomain);
  const [customDomains, setCustomDomains] = useState(tenant.customDomains.join(', '));
  const [vercelProjectId, setVercelProjectId] = useState(tenant.publicwebsiteVercelProjectId);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(tenant.deliveryMode);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await apiRequest(`/api/platform/tenants/${encodeURIComponent(tenant.tenantId)}`, {
        method: 'PATCH',
        body: {
          displayName: displayName.trim(),
          cmsProjectId: cmsProjectId.trim(),
          cmsHost: cmsHost.trim(),
          publicwebsiteHost: publicwebsiteHost.trim(),
          primaryDomain: primaryDomain.trim(),
          publicwebsiteVercelProjectId: vercelProjectId.trim(),
          deliveryMode,
          customDomains: customDomains
            .split(',')
            .map((domain) => domain.trim())
            .filter((domain) => domain.length > 0),
        },
      });
      setSuccessMessage('Tenant metadata updated.');
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'The tenant could not be updated.',
      );
    } finally {
      setPending(false);
    }
  }

  if (!expanded) {
    return (
      <div className="space-y-2">
        <Button variant="secondary" size="sm" onClick={() => setExpanded(true)}>
          Edit tenant metadata
        </Button>
        {successMessage ? (
          <div aria-live="polite">
            <Alert tone="success">{successMessage}</Alert>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} autoComplete="off">
      {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
      {successMessage ? <Alert tone="success">{successMessage}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Display name"
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          autoComplete="off"
        />
        <TextInput
          label="CMS project id"
          value={cmsProjectId}
          onChange={(event) => setCmsProjectId(event.target.value)}
          autoComplete="off"
        />
        <TextInput
          label="CMS host"
          value={cmsHost}
          onChange={(event) => setCmsHost(event.target.value)}
          autoComplete="off"
        />
        <TextInput
          label="Public website host"
          value={publicwebsiteHost}
          onChange={(event) => setPublicwebsiteHost(event.target.value)}
          autoComplete="off"
        />
        <TextInput
          label="Primary custom domain"
          value={primaryDomain}
          onChange={(event) => setPrimaryDomain(event.target.value)}
          autoComplete="off"
        />
        <TextInput
          label="Additional custom domains"
          value={customDomains}
          onChange={(event) => setCustomDomains(event.target.value)}
          autoComplete="off"
          hint="Comma separated."
        />
        <TextInput
          label="Vercel project id"
          value={vercelProjectId}
          onChange={(event) => setVercelProjectId(event.target.value)}
          autoComplete="off"
        />
        <SelectInput
          label="Secret delivery mode"
          value={deliveryMode}
          onChange={(event) => setDeliveryMode(event.target.value as DeliveryMode)}
          options={[
            { value: 'manual', label: 'Manual' },
            { value: 'runtime-fetch', label: 'Runtime fetch' },
            { value: 'vercel-env', label: 'Vercel environment variable' },
          ]}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Save changes'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setExpanded(false)} disabled={pending}>
          Close
        </Button>
      </div>
    </form>
  );
}
