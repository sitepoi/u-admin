'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectInput, TextInput } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { apiRequest, ApiClientError } from '@/lib/client/api';
import type {
  PlatformProject,
  ProjectAccessMode,
  ProjectTenantSource,
} from '@/lib/shared/platform-types';

interface ProjectFormState {
  projectId: string;
  displayName: string;
  tenantSource: ProjectTenantSource;
  accessMode: ProjectAccessMode;
  tenantCollection: string;
  tenantIdField: string;
  tenantNameField: string;
  tenantStatusField: string;
}

const INITIAL_FORM_STATE: ProjectFormState = {
  projectId: '',
  displayName: '',
  tenantSource: 'firestore',
  accessMode: 'read-only',
  tenantCollection: 'tenants',
  tenantIdField: 'tenantId',
  tenantNameField: 'displayName',
  tenantStatusField: 'status',
};

export function ProjectCreateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formState, setFormState] = useState<ProjectFormState>(INITIAL_FORM_STATE);

  function updateField<K extends keyof ProjectFormState>(
    field: K,
    value: ProjectFormState[K],
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

    try {
      const result = await apiRequest<{ project: PlatformProject }>('/api/platform/projects', {
        method: 'POST',
        body: {
          projectId: formState.projectId.trim(),
          displayName: formState.displayName.trim(),
          tenantSource: formState.tenantSource,
          accessMode: formState.accessMode,
          ...(formState.tenantSource === 'firestore'
            ? {
                tenantCollection: formState.tenantCollection.trim(),
                tenantIdField: formState.tenantIdField.trim(),
                tenantNameField: formState.tenantNameField.trim(),
                tenantStatusField: formState.tenantStatusField.trim(),
              }
            : {}),
        },
      });

      setOpen(false);
      setFormState(INITIAL_FORM_STATE);
      router.push(`/projects/${result.project.projectId}/tenants`);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'The project could not be added.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add project</Button>

      <Modal
        open={open}
        onClose={closeDialog}
        title="Add a managed project"
        description="The admin project stores the registry only. Tenants stay inside the managed project."
        footer={
          <>
            <Button variant="secondary" onClick={closeDialog} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="create-project-form" disabled={pending}>
              {pending ? 'Adding...' : 'Add project'}
            </Button>
          </>
        }
      >
        <form id="create-project-form" className="space-y-4" onSubmit={handleSubmit} autoComplete="off">
          {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

          <TextInput
            label="Project id"
            required
            value={formState.projectId}
            onChange={(event) => updateField('projectId', event.target.value)}
            placeholder="acme-platform-prod"
            autoComplete="off"
            spellCheck={false}
            hint="Firebase/GCP project id, 6-30 characters. This is a project, not a tenant."
          />
          <TextInput
            label="Display name"
            required
            value={formState.displayName}
            onChange={(event) => updateField('displayName', event.target.value)}
            placeholder="Acme Platform"
            autoComplete="off"
          />

          <SelectInput
            label="Tenant source"
            value={formState.tenantSource}
            onChange={(event) =>
              updateField('tenantSource', event.target.value as ProjectTenantSource)
            }
            options={[
              { value: 'firestore', label: 'Firestore collection' },
              { value: 'identity-platform', label: 'Identity Platform tenants' },
            ]}
            hint="Where the project keeps its tenants."
          />

          <SelectInput
            label="Access mode"
            value={formState.accessMode}
            onChange={(event) =>
              updateField('accessMode', event.target.value as ProjectAccessMode)
            }
            options={[
              { value: 'read-only', label: 'Read-only (recommended)' },
              { value: 'read-write', label: 'Read and write' },
            ]}
            hint="Read-only matches roles/datastore.viewer. Writes need roles/datastore.user on the project."
          />

          {formState.tenantSource === 'firestore' ? (
            <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <TextInput
                label="Tenant collection"
                required
                value={formState.tenantCollection}
                onChange={(event) => updateField('tenantCollection', event.target.value)}
                placeholder="tenants"
                autoComplete="off"
                hint="Firestore collection id in the managed project."
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <TextInput
                  label="Id field"
                  value={formState.tenantIdField}
                  onChange={(event) => updateField('tenantIdField', event.target.value)}
                  autoComplete="off"
                  hint="Optional."
                />
                <TextInput
                  label="Name field"
                  value={formState.tenantNameField}
                  onChange={(event) => updateField('tenantNameField', event.target.value)}
                  autoComplete="off"
                  hint="Optional."
                />
                <TextInput
                  label="Status field"
                  value={formState.tenantStatusField}
                  onChange={(event) => updateField('tenantStatusField', event.target.value)}
                  autoComplete="off"
                  hint="Optional."
                />
              </div>
            </div>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
