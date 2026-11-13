'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextInput, SelectInput } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { apiRequest, ApiClientError } from '@/lib/client/api';
import type { DeliveryMode } from '@/lib/shared/constants';
import type { TenantDetail } from '@/lib/shared/platform-types';

interface CreateTenantFormState {
  tenantId: string;
  displayName: string;
  cmsProjectId: string;
  cmsHost: string;
  publicwebsiteHost: string;
  primaryDomain: string;
  customDomains: string;
  publicwebsiteVercelProjectId: string;
  deliveryMode: DeliveryMode;
}

const INITIAL_FORM_STATE: CreateTenantFormState = {
  tenantId: '',
  displayName: '',
  cmsProjectId: '',
  cmsHost: '',
  publicwebsiteHost: '',
  primaryDomain: '',
  customDomains: '',
  publicwebsiteVercelProjectId: '',
  deliveryMode: 'manual',
};

export function TenantCreateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formState, setFormState] = useState<CreateTenantFormState>(INITIAL_FORM_STATE);

  function updateField<K extends keyof CreateTenantFormState>(
    field: K,
    value: CreateTenantFormState[K],
  ): void {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }

  function closeDialog(): void {
    if (pending) return;
    setOpen(false);
    setErrorMessage(null);
    setFormState(INITIAL_FORM_STATE);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);

    const customDomains = formState.customDomains
      .split(',')
      .map((domain) => domain.trim())
      .filter((domain) => domain.length > 0);

    try {
      const result = await apiRequest<{ tenant: TenantDetail }>('/api/platform/tenants', {
        method: 'POST',
        body: {
          tenantId: formState.tenantId.trim(),
          displayName: formState.displayName.trim(),
          ...(formState.cmsProjectId.trim()
            ? { cmsProjectId: formState.cmsProjectId.trim() }
            : {}),
          ...(formState.cmsHost.trim() ? { cmsHost: formState.cmsHost.trim() } : {}),
          ...(formState.publicwebsiteHost.trim()
            ? { publicwebsiteHost: formState.publicwebsiteHost.trim() }
            : {}),
          ...(formState.primaryDomain.trim()
            ? { primaryDomain: formState.primaryDomain.trim() }
            : {}),
          ...(formState.publicwebsiteVercelProjectId.trim()
            ? { publicwebsiteVercelProjectId: formState.publicwebsiteVercelProjectId.trim() }
            : {}),
          ...(customDomains.length > 0 ? { customDomains } : {}),
          deliveryMode: formState.deliveryMode,
        },
      });

      setOpen(false);
      setFormState(INITIAL_FORM_STATE);
      router.push(`/tenants/${result.tenant.tenantId}`);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'The tenant could not be created.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>New tenant</Button>

      <Modal
        open={open}
        onClose={closeDialog}
        title="Create tenant record"
        description="The record is created in draft status. Provisioning is a separate, retryable step."
        footer={
          <>
            <Button variant="secondary" onClick={closeDialog} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="create-tenant-form" disabled={pending}>
              {pending ? 'Creating...' : 'Create tenant'}
            </Button>
          </>
        }
      >
        <form id="create-tenant-form" className="space-y-4" onSubmit={handleSubmit} autoComplete="off">
          {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

          <TextInput
            label="Tenant id"
            required
            value={formState.tenantId}
            onChange={(event) => updateField('tenantId', event.target.value)}
            placeholder="acme-travel"
            autoComplete="off"
            spellCheck={false}
            hint="Lowercase letters, digits and hyphens. 2-63 characters. Used as the document id and host prefix."
          />
          <TextInput
            label="Display name"
            required
            value={formState.displayName}
            onChange={(event) => updateField('displayName', event.target.value)}
            placeholder="Acme Travel"
            autoComplete="off"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="CMS project id"
              value={formState.cmsProjectId}
              onChange={(event) => updateField('cmsProjectId', event.target.value)}
              placeholder="tenant-acme-travel"
              autoComplete="off"
              hint="Defaults to tenant-<tenantId>."
            />
            <TextInput
              label="Public website Vercel project id"
              value={formState.publicwebsiteVercelProjectId}
              onChange={(event) => updateField('publicwebsiteVercelProjectId', event.target.value)}
              autoComplete="off"
              hint="Optional."
            />
            <TextInput
              label="CMS host"
              value={formState.cmsHost}
              onChange={(event) => updateField('cmsHost', event.target.value)}
              placeholder="acme-travel.cms.uniconhub.com"
              autoComplete="off"
              hint="Optional. Generated from the tenant id when empty."
            />
            <TextInput
              label="Public website host"
              value={formState.publicwebsiteHost}
              onChange={(event) => updateField('publicwebsiteHost', event.target.value)}
              placeholder="acme-travel.publicwebsite.uniconhub.com"
              autoComplete="off"
              hint="Optional. Generated from the tenant id when empty."
            />
            <TextInput
              label="Primary custom domain"
              value={formState.primaryDomain}
              onChange={(event) => updateField('primaryDomain', event.target.value)}
              placeholder="www.acme-travel.com"
              autoComplete="off"
            />
            <TextInput
              label="Additional custom domains"
              value={formState.customDomains}
              onChange={(event) => updateField('customDomains', event.target.value)}
              placeholder="acme-travel.com, book.acme-travel.com"
              autoComplete="off"
              hint="Comma separated. Optional."
            />
          </div>

          <SelectInput
            label="Secret delivery mode"
            value={formState.deliveryMode}
            onChange={(event) =>
              updateField('deliveryMode', event.target.value as DeliveryMode)
            }
            options={[
              { value: 'manual', label: 'Manual' },
              { value: 'runtime-fetch', label: 'Runtime fetch' },
              { value: 'vercel-env', label: 'Vercel environment variable' },
            ]}
            hint="The Secret API owns delivery. This is the tenant default."
          />
        </form>
      </Modal>
    </>
  );
}
