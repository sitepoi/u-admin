'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { apiRequest, ApiClientError } from '@/lib/client/api';
import { formatNumber } from '@/lib/client/format';
import type { StatisticsBatchRefreshResponse } from '@/lib/shared/platform-types';

interface AnalyzeProgress {
  examinedTenants: number;
  totalTenants: number;
  refreshedTenants: number;
  skippedTenants: number;
  failedTenants: number;
  reads: number;
  writes: number;
}

const MAX_BATCH_REQUESTS = 2_000;

/**
 * Walks every relay tenant in small server-side batches. The server returns one
 * time-boxed batch per request, and the browser repeats with `nextOffset` so a
 * large portfolio never runs into a single function timeout.
 */
export function AnalyzeAllTenantsButton({ projectId }: { projectId?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [firstFailureMessage, setFirstFailureMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [finished, setFinished] = useState(false);

  async function handleAnalyze(): Promise<void> {
    setPending(true);
    setErrorMessage(null);
    setFirstFailureMessage(null);
    setFinished(false);

    const accumulated: AnalyzeProgress = {
      examinedTenants: 0,
      totalTenants: 0,
      refreshedTenants: 0,
      skippedTenants: 0,
      failedTenants: 0,
      reads: 0,
      writes: 0,
    };
    setProgress({ ...accumulated });

    let offset = 0;
    try {
      for (let requestCount = 0; requestCount < MAX_BATCH_REQUESTS; requestCount += 1) {
        const result = await apiRequest<StatisticsBatchRefreshResponse>(
          '/api/platform/statistics/refresh-all',
          {
            method: 'POST',
            body: { projectId, offset },
          },
        );

        accumulated.examinedTenants += result.examinedTenants;
        accumulated.totalTenants = result.totalTenants;
        accumulated.refreshedTenants += result.refreshedTenants;
        accumulated.skippedTenants += result.skippedTenants;
        accumulated.failedTenants += result.failedTenants;
        accumulated.reads += result.cost.reads;
        accumulated.writes += result.cost.writes;
        setProgress({ ...accumulated });

        const firstFailure = result.results.find(
          (tenantResult) =>
            tenantResult.outcome === 'failed' && Boolean(tenantResult.errorMessage),
        );
        if (firstFailure?.errorMessage) {
          setFirstFailureMessage(firstFailure.errorMessage);
        }

        if (result.done) break;
        if (result.nextOffset <= offset) {
          throw new Error('The batch did not advance. Reload the page and try again.');
        }
        offset = result.nextOffset;
      }

      setFinished(true);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Tenant analysis failed.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={handleAnalyze}
        disabled={pending}
      >
        {pending ? 'Analyzing...' : 'Analyze all tenants'}
      </Button>

      {progress ? (
        <p aria-live="polite" className="max-w-sm text-right text-xs text-slate-500">
          {pending
            ? `${formatNumber(progress.examinedTenants)} of ${formatNumber(
                progress.totalTenants,
              )} tenants. ${formatNumber(progress.reads)} reads, ${formatNumber(
                progress.writes,
              )} writes so far.`
            : finished
              ? `Done. ${formatNumber(progress.refreshedTenants)} refreshed, ${formatNumber(
                  progress.skippedTenants,
                )} skipped, ${formatNumber(progress.failedTenants)} failed. ${formatNumber(
                  progress.reads,
                )} reads / ${formatNumber(progress.writes)} writes.`
              : progress.examinedTenants > 0
                ? `Stopped after ${formatNumber(progress.examinedTenants)} of ${formatNumber(
                    progress.totalTenants,
                  )} tenants. ${formatNumber(progress.reads)} reads / ${formatNumber(
                    progress.writes,
                  )} writes.`
                : null}
        </p>
      ) : null}

      {firstFailureMessage ? (
        <span className="max-w-sm text-right text-xs break-words text-amber-700">
          First failure: {firstFailureMessage}
        </span>
      ) : null}

      {errorMessage ? (
        <span className="max-w-sm text-right text-xs text-rose-600">{errorMessage}</span>
      ) : null}
    </div>
  );
}
