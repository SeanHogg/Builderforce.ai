import { describe, expect, it } from 'vitest';
import {
  WATERMARK_ORIGIN,
  compareWatermark,
  isXid8,
  nextDeltaCursor,
  type SyncWatermark,
} from './deltaWatermark';

const w = (txid: string, seq: number): SyncWatermark => ({ txid, seq });

describe('isXid8', () => {
  it('accepts canonical decimal 64-bit ids and refuses everything else', () => {
    for (const ok of ['0', '7', '18446744073709551615', '9007199254740993']) expect(isXid8(ok)).toBe(true);
    for (const bad of ['', '-1', '01', '1.5', '18446744073709551616', 'abc', 12, null, undefined]) {
      expect(isXid8(bad)).toBe(false);
    }
  });
});

describe('compareWatermark', () => {
  it('orders by txid first, then seq, beyond 2^53', () => {
    expect(compareWatermark(w('9007199254740993', 1), w('9007199254740992', 99))).toBeGreaterThan(0);
    expect(compareWatermark(w('5', 2), w('5', 3))).toBeLessThan(0);
    expect(compareWatermark(w('5', 2), w('5', 2))).toBe(0);
    expect(compareWatermark(WATERMARK_ORIGIN, w('0', 1))).toBeLessThan(0);
  });
});

describe('nextDeltaCursor', () => {
  it('resumes a full page at its last row', () => {
    const rows = [w('100', 10), w('101', 11)];
    expect(nextDeltaCursor({ rows, limit: 2, prior: w('90', 0), xmin: '500' })).toEqual(w('101', 11));
  });

  it('advances a drained page to (xmin, 0), never to a row or tip above xmin', () => {
    const rows = [w('100', 10)];
    expect(nextDeltaCursor({ rows, limit: 50, prior: w('90', 0), xmin: '120' })).toEqual(w('120', 0));
    expect(nextDeltaCursor({ rows: [], limit: 50, prior: w('90', 0), xmin: '120' })).toEqual(w('120', 0));
  });

  it('never moves backwards', () => {
    expect(nextDeltaCursor({ rows: [], limit: 50, prior: w('200', 5), xmin: '120' })).toEqual(w('200', 5));
  });

  it('does not skip a late commit: a row above xmin is withheld, then delivered once its transaction ends', () => {
    // Transaction A (txid 100) took seq 10 and is still open. Transaction B (txid 101)
    // took seq 11 and committed. The database xmin is therefore 100 (A is in flight).
    const log = [w('100', 10), w('101', 11)];
    const committed = new Set(['101']);
    const read = (after: SyncWatermark, xmin: string) =>
      log
        .filter((row) => committed.has(row.txid))
        .filter((row) => compareWatermark(row, after) > 0 && BigInt(row.txid) < BigInt(xmin))
        .sort(compareWatermark);

    // Pull 1: B's row (101) is not below xmin (100), so it is withheld.
    const first = read(WATERMARK_ORIGIN, '100');
    expect(first).toEqual([]);
    const cursor1 = nextDeltaCursor({ rows: first, limit: 50, prior: WATERMARK_ORIGIN, xmin: '100' });
    expect(cursor1).toEqual(w('100', 0));

    // A commits; nothing is in flight, xmin moves past both.
    committed.add('100');
    const second = read(cursor1, '102');
    expect(second).toEqual([w('100', 10), w('101', 11)]);
    expect(nextDeltaCursor({ rows: second, limit: 50, prior: cursor1, xmin: '102' })).toEqual(w('102', 0));
  });

  it('delivers rows committed out of seq order exactly once across pages', () => {
    // seq order 10 (txid 102), 11 (txid 100), 12 (txid 101): commit order is txid order.
    const log = [w('102', 10), w('100', 11), w('101', 12)];
    const page = (after: SyncWatermark, limit: number) =>
      log.filter((row) => compareWatermark(row, after) > 0 && BigInt(row.txid) < 103n).sort(compareWatermark).slice(0, limit);
    const seen: SyncWatermark[] = [];
    let cursor = WATERMARK_ORIGIN;
    for (let guard = 0; guard < 5; guard += 1) {
      const rows = page(cursor, 2);
      seen.push(...rows);
      cursor = nextDeltaCursor({ rows, limit: 2, prior: cursor, xmin: '103' });
      if (rows.length < 2) break;
    }
    expect(seen).toEqual([w('100', 11), w('101', 12), w('102', 10)]);
  });
});
