'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiRequest, ApiClientError } from '@/lib/client/api';
import type { ProjectAccessMode } from '@/lib/shared/platform-types';

export function ProjectAccessForm({
  projectId,
  accessMode,
}: {
  projectId: string;
  accessMode: ProjectAccessMode;
}) {
  const router = useRouter();
  const [value, setValue] = useState<ProjectAccessMode>(accessMode);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);
    setSavedMessage(null);

    try {
      await apiRequest(`/api/platform/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        body: { accessMode: value },
      });
      setSavedMessage('Access mode updated.');
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'The access mode could not be updated.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
      <div className="min-w-[240px]">
        <label
          htmlFor="project-access-mode"
          className="block text-sm font-medium text-slate-800"
        >
          Cross-project access
        </label>
        <select
          id="project-access-mode"
          value={value}
          onChange={(event) => setValue(event.target.value as ProjectAccessMode)}
          className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-600"
        >
          <option value="read-only">Read-only (datastore.viewer)</option>
          <option value="read-write">Read and write (datastore.user)</option>
        </select>
      </div>
      <Button type="submit" variant="secondary" disabled={pending || value === accessMode}>
        {pending ? 'Saving...' : 'Save access'}
      </Button>
      {savedMessage ? <Alert tone="success">{savedMessage}</Alert> : null}
      {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
    </form>
  );
}
