import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';

import { FirestoreCostMeter } from '@/lib/server/firestore/cost-meter';
import { getPlatformFirestore } from '@/lib/server/firebase/admin';
import type {
  StatisticsOperationMetrics,
  StatisticsOperationRun,
} from '@/lib/shared/platform-types';

/** One small document keeps the last batch cost plus lifetime totals. */
const OPERATION_METRICS_COLLECTION = 'platform_operation_metrics';
const STATISTICS_METRICS_DOCUMENT_ID = 'statistics';

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readLastRun(value: unknown): StatisticsOperationRun | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const runId = readString(record.runId);
  if (!runId) return null;
  return {
    runId,
    startedAt: readString(record.startedAt),
    finishedAt: readString(record.finishedAt),
    totalTenants: readNumber(record.totalTenants),
    examinedTenants: readNumber(record.examinedTenants),
    refreshedTenants: readNumber(record.refreshedTenants),
    skippedTenants: readNumber(record.skippedTenants),
    failedTenants: readNumber(record.failedTenants),
    reads: readNumber(record.reads),
    writes: readNumber(record.writes),
    durationMs: readNumber(record.durationMs),
  };
}

/**
 * Reads the last batch record. Opening the applications page pays one extra
 * document read for this; when the document is missing the read is still
 * billed, so the meter records it either way.
 */
export async function getStatisticsOperationMetrics(
  meter?: FirestoreCostMeter,
): Promise<StatisticsOperationMetrics> {
  const snapshot = await getPlatformFirestore()
    .collection(OPERATION_METRICS_COLLECTION)
    .doc(STATISTICS_METRICS_DOCUMENT_ID)
    .get();
  meter?.recordDocumentReads(1);

  const data = snapshot.data() ?? {};
  const lifetimeRecord =
    typeof data.lifetime === 'object' && data.lifetime !== null
      ? (data.lifetime as Record<string, unknown>)
      : {};

  return {
    lastRun: readLastRun(data.lastRun),
    lifetime: {
      runs: readNumber(lifetimeRecord.runs),
      tenantsExamined: readNumber(lifetimeRecord.tenantsExamined),
      tenantsFailed: readNumber(lifetimeRecord.tenantsFailed),
      reads: readNumber(lifetimeRecord.reads),
      writes: readNumber(lifetimeRecord.writes),
    },
  };
}

/**
 * Appends the batch totals with field increments so the write does not need a
 * preceding read. The caller must count this write in the reported cost.
 */
export async function recordStatisticsBatchRun(
  run: StatisticsOperationRun,
): Promise<void> {
  await getPlatformFirestore()
    .collection(OPERATION_METRICS_COLLECTION)
    .doc(STATISTICS_METRICS_DOCUMENT_ID)
    .set(
      {
        lastRun: run,
        lifetime: {
          runs: FieldValue.increment(1),
          tenantsExamined: FieldValue.increment(run.examinedTenants),
          tenantsFailed: FieldValue.increment(run.failedTenants),
          reads: FieldValue.increment(run.reads),
          writes: FieldValue.increment(run.writes),
        },
        updatedAt: run.finishedAt,
      },
      { merge: true },
    );
}
