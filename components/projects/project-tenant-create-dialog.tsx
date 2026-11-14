'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { apiRequest, ApiClientError } from '@/lib/client/api';
import type { ProjectTenantSource, ProjectTenantSummary } from '@/lib/shared/platform-types';

export function ProjectTenantCreateDialog({
  projectId,
  tenantSource,
}: {
  projectId: string;
  tenantSource: ProjectTenantSource;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState('active');

  function closeDialog(): void {
    if (pending) return;
    setOpen(false);
    setErrorMessage(null);
    setTenantId('');
    setDisplayName('');
    setStatus('active');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);

    try {
      const result = await apiRequest<{ tenant: ProjectTenantSummary }>(
        `/api/platform/projects/${encodeURIComponent(projectId)}/tenants`,
        {
          method: 'POST',
          body: {
            displayName: displayName.trim(),
            ...(tenantSource === 'firestore'
              ? {
                  tenantId: tenantId.trim(),
                  ...(status.trim() ? { status: status.trim() } : {}),
                }
              : {}),
          },
        },
      );

      setOpen(false);
      setTenantId('');
      setDisplayName('');
      setStatus('active');
      router.push(
        `/projects/${encodeURIComponent(projectId)}/tenants/${encodeURIComponent(
          result.tenant.recordId ?? result.tenant.tenantId,
        )}`,
      );
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
        title="Create tenant in project"
        description={`The record is written to ${projectId}. The admin project stores no tenant data.`}
        footer={
          <>
            <Button variant="secondary" onClick={closeDialog} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="create-project-tenant-form" disabled={pending}>
              {pending ? 'Creating...' : 'Create tenant'}
            </Button>
          </>
        }
      >
        <form
          id="create-project-tenant-form"
          className="space-y-4"
          onSubmit={handleSubmit}
          autoComplete="off"
        >
          {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

          {tenantSource === 'firestore' ? (
            <TextInput
              label="Tenant id"
              required
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              hint="Used as the Firestore document id."
            />
          ) : (
            <p className="text-xs text-slate-500">
              Identity Platform assigns the tenant id automatically. The new id is shown on the
              tenant page after creation.
            </p>
          )}
          <TextInput
            label="Display name"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="off"
          />
          {tenantSource === 'firestore' ? (
            <TextInput
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              autoComplete="off"
              hint="Written to the configured status field."
            />
          ) : null}
        </form>
      </Modal>
    </>
  );
}
