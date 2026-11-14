'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/form';
import { apiRequest, ApiClientError } from '@/lib/client/api';
import type { ProjectTenantSource, ProjectTenantSummary } from '@/lib/shared/platform-types';

export function ProjectTenantEditForm({
  projectId,
  tenant,
  tenantSource,
}: {
  projectId: string;
  tenant: ProjectTenantSummary;
  tenantSource: ProjectTenantSource;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(tenant.displayName);
  const [status, setStatus] = useState(tenant.status);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);
    setSavedMessage(null);

    try {
      await apiRequest<{ tenant: ProjectTenantSummary }>(
        `/api/platform/projects/${encodeURIComponent(projectId)}/tenants/${encodeURIComponent(
          tenant.recordId ?? tenant.tenantId,
        )}`,
        {
          method: 'PATCH',
          body: {
            displayName: displayName.trim(),
            ...(tenantSource === 'firestore' ? { status: status.trim() } : {}),
          },
        },
      );

      setSavedMessage('Tenant updated in the managed project.');
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'The tenant could not be updated.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} autoComplete="off">
      {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
      {savedMessage ? <Alert tone="success">{savedMessage}</Alert> : null}

      <TextInput
        label="Display name"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        required
        autoComplete="off"
      />

      {tenantSource === 'firestore' ? (
        <TextInput
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          autoComplete="off"
          hint="Stored in the project's configured status field."
        />
      ) : (
        <p className="text-xs text-slate-500">
          Identity Platform tenants have no status field. Only the display name is editable here.
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save changes'}
      </Button>
    </form>
  );
}
