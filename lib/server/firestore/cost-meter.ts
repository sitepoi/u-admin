import 'server-only';

import type { FirestoreCostSummary } from '@/lib/shared/platform-types';

/**
 * Firestore bills a count() aggregation as one document read for every 1,000
 * index entries matched by the query, with a minimum of one read per query.
 */
const COUNT_ENTRIES_PER_READ = 1_000;

/**
 * Counts the Firestore operations a server action performs so the UI can show
 * the real cost instead of a guess.
 *
 * What is billed:
 * - every document returned by a query or read with get(): 1 read each,
 * - every count() aggregation: 1 read per 1,000 matched entries (minimum 1),
 * - every set(), update(), create() or delete(): 1 write each.
 *
 * Queries that return no documents are not charged, so recordDocumentReads(0)
 * is intentionally a no-op.
 */
export class FirestoreCostMeter {
  private countQueries = 0;
  private countReads = 0;
  private documentReads = 0;
  private writes = 0;

  recordCountQuery(matchedDocumentCount: number): void {
    this.countQueries += 1;
    const safeCount = Number.isFinite(matchedDocumentCount)
      ? Math.max(0, matchedDocumentCount)
      : 0;
    this.countReads += Math.max(1, Math.ceil(safeCount / COUNT_ENTRIES_PER_READ));
  }

  recordDocumentReads(readCount: number): void {
    if (!Number.isFinite(readCount) || readCount <= 0) return;
    this.documentReads += readCount;
  }

  recordWrites(writeCount = 1): void {
    if (!Number.isFinite(writeCount) || writeCount <= 0) return;
    this.writes += writeCount;
  }

  merge(other: FirestoreCostMeter): void {
    this.countQueries += other.countQueries;
    this.countReads += other.countReads;
    this.documentReads += other.documentReads;
    this.writes += other.writes;
  }

  toSummary(): FirestoreCostSummary {
    return {
      reads: this.countReads + this.documentReads,
      writes: this.writes,
      countQueries: this.countQueries,
      countReads: this.countReads,
      documentReads: this.documentReads,
      operations: this.countQueries + this.documentReads + this.writes,
    };
  }
}
