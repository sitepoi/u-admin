'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/form';
import { apiRequest, ApiClientError } from '@/lib/client/api';
import {
  TENANT_LIFECYCLE_STATUSES,
  type TenantControlRecord,
  type TenantLifecycleStatus,
} from '@/lib/shared/platform-types';

export function TenantControlForm({
  projectId,
  applicationId,
  fallbackDisplayName,
  initial,
}: {
  projectId: string;
  applicationId: string;
  fallbackDisplayName: string;
  initial: TenantControlRecord | null;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial?.displayName ?? fallbackDisplayName);
  const [status, setStatus] = useState<TenantLifecycleStatus>(initial?.status ?? 'active');
  const [plan, setPlan] = useState(initial?.plan ?? '');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [ownerEmail, setOwnerEmail] = useState(initial?.ownerEmail ?? '');
  const [adminEmail, setAdminEmail] = useState(initial?.adminEmail ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);
    setSavedMessage(null);

    try {
      await apiRequest(
        `/api/platform/projects/${encodeURIComponent(projectId)}/tenants/${encodeURIComponent(
          applicationId,
        )}/control`,
        {
          method: 'PATCH',
          body: { displayName, status, plan, region, ownerEmail, adminEmail, notes },
        },
      );
      setSavedMessage('Tenant control record saved.');
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError
          ? error.message
          : 'The tenant control record could not be saved.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} autoComplete="off">
      {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
      {savedMessage ? <Alert tone="success">{savedMessage}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Display name"
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          autoComplete="off"
        />
        <div>
          <label htmlFor="tenant-status" className="block text-sm font-medium text-slate-800">
            Status
          </label>
          <select
            id="tenant-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as TenantLifecycleStatus)}
            className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-600"
          >
            {TENANT_LIFECYCLE_STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <TextInput
          label="Plan / package"
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          autoComplete="off"
        />
        <TextInput
          label="Region"
          value={region}
          onChange={(event) => setRegion(event.target.value)}
          autoComplete="off"
        />
        <TextInput
          label="Owner email"
          type="email"
          value={ownerEmail}
          onChange={(event) => setOwnerEmail(event.target.value)}
          autoComplete="off"
        />
        <TextInput
          label="Primary admin email"
          type="email"
          value={adminEmail}
          onChange={(event) => setAdminEmail(event.target.value)}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor="tenant-notes" className="block text-sm font-medium text-slate-800">
          Notes
        </label>
        <textarea
          id="tenant-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-600"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save control record'}
      </Button>
    </form>
  );
}
