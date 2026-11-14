'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { apiRequest, ApiClientError } from '@/lib/client/api';

export function RefreshTenantStatsButton({
  projectId,
  tenantId,
  applicationId,
}: {
  projectId: string;
  tenantId: string;
  applicationId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleRefresh(): Promise<void> {
    setPending(true);
    setErrorMessage(null);
    try {
      await apiRequest('/api/platform/statistics/refresh', {
        method: 'POST',
        body: { projectId, tenantId, applicationId },
      });
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Statistics could not be refreshed.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handleRefresh}
        disabled={pending}
      >
        {pending ? 'Refreshing...' : 'Refresh statistics'}
      </Button>
      {errorMessage ? (
        <span className="max-w-xs text-right text-xs text-rose-600">{errorMessage}</span>
      ) : null}
    </div>
  );
}
