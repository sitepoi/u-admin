'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { apiRequest, ApiClientError } from '@/lib/client/api';
import { formatNumber } from '@/lib/client/format';
import type { FirestoreCostSummary } from '@/lib/shared/platform-types';

export function RefreshReportingButton({
  disabled = false,
  label = 'Refresh reporting',
}: {
  disabled?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleRefresh(): Promise<void> {
    setPending(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await apiRequest<{
        tenantCount: number;
        tenantFailureCount: number;
        cost: FirestoreCostSummary;
      }>('/api/platform/reporting/refresh', { method: 'POST' });
      setSuccessMessage(
        `Snapshot updated for ${result.tenantCount} tenant(s), ${result.tenantFailureCount} partial failure(s). ${formatNumber(
          result.cost.reads,
        )} reads / ${formatNumber(result.cost.writes)} writes.`,
      );
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Reporting refresh failed.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleRefresh} disabled={pending || disabled} variant="secondary" size="sm">
        {pending ? 'Refreshing...' : label}
      </Button>
      <div aria-live="polite">
        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
        {successMessage ? <Alert tone="success">{successMessage}</Alert> : null}
      </div>
    </div>
  );
}
