import { describe, expect, it } from 'vitest';

import { FirestoreCostMeter } from '@/lib/server/firestore/cost-meter';

describe('FirestoreCostMeter', () => {
  it('bills a count query as one read for every 1,000 matched entries', () => {
    const meter = new FirestoreCostMeter();

    meter.recordCountQuery(0);
    meter.recordCountQuery(1);
    meter.recordCountQuery(1_000);
    meter.recordCountQuery(1_001);
    meter.recordCountQuery(2_500);

    const summary = meter.toSummary();
    expect(summary.countQueries).toBe(5);
    // 1 + 1 + 1 + 2 + 3 reads.
    expect(summary.countReads).toBe(8);
    expect(summary.reads).toBe(8);
  });

  it('ignores queries that return no documents', () => {
    const meter = new FirestoreCostMeter();
    meter.recordDocumentReads(0);
    expect(meter.toSummary().documentReads).toBe(0);
  });

  it('adds document reads, writes and operations', () => {
    const meter = new FirestoreCostMeter();
    meter.recordDocumentReads(3);
    meter.recordCountQuery(10);
    meter.recordWrites(2);

    expect(meter.toSummary()).toEqual({
      reads: 4,
      writes: 2,
      countQueries: 1,
      countReads: 1,
      documentReads: 3,
      operations: 6,
    });
  });

  it('merges a per-tenant meter into the request meter', () => {
    const requestMeter = new FirestoreCostMeter();
    requestMeter.recordDocumentReads(2);

    const tenantMeter = new FirestoreCostMeter();
    tenantMeter.recordCountQuery(1_500);
    tenantMeter.recordWrites(2);

    requestMeter.merge(tenantMeter);

    expect(requestMeter.toSummary()).toEqual({
      reads: 4,
      writes: 2,
      countQueries: 1,
      countReads: 2,
      documentReads: 2,
      operations: 5,
    });
  });
});
