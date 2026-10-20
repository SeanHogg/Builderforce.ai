import { describe, expect, it } from 'vitest';
import {
  CURSOR_RETENTION_MARGIN_DAYS,
  RESNAPSHOT_REQUIRED,
  decodeSyncCursor,
  deltaCursorExpired,
  encodeSyncCursor,
  type DeltaCursor,
} from './cursorCodec';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ISSUED = NOW.getTime() - 60_000;

describe('encodeSyncCursor / decodeSyncCursor', () => {
  it('round-trips a delta and a snapshot cursor, including seq 0', () => {
    const delta: DeltaCursor = { v: 1, kind: 'delta', seq: 0, issuedAt: ISSUED };
    expect(decodeSyncCursor(encodeSyncCursor(delta))).toEqual(delta);
    const snapshot = {
      v: 1 as const,
      kind: 'snapshot' as const,
      afterEntityType: 'ticket',
      afterClientEntityId: 'b',
      tip: 42,
      issuedAt: ISSUED,
    };
    expect(decodeSyncCursor(encodeSyncCursor(snapshot))).toEqual(snapshot);
  });

  it('is null — never sequence 0 — for anything it did not mint', () => {
    const forged = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '');
    for (const raw of [
      undefined,
      null,
      '',
      '   ',
      '0',
      'not-a-cursor',
      'bfc1.3.abcdef01',
      forged({ v: 2, kind: 'delta', seq: 1, issuedAt: ISSUED }),
      forged({ v: 1, kind: 'delta', seq: -1, issuedAt: ISSUED }),
      forged({ v: 1, kind: 'delta', seq: 1.5, issuedAt: ISSUED }),
      forged({ v: 1, kind: 'delta', seq: 1 }),
      forged({ v: 1, kind: 'snapshot', afterEntityType: 'ticket', afterClientEntityId: 'a', issuedAt: ISSUED }),
      forged('delta'),
    ]) {
      expect(decodeSyncCursor(raw)).toBeNull();
    }
  });

  it('exposes one frozen resnapshot flag with no rows', () => {
    expect(RESNAPSHOT_REQUIRED).toEqual({ resnapshotRequired: true });
    expect(Object.isFrozen(RESNAPSHOT_REQUIRED)).toBe(true);
  });
});

describe('deltaCursorExpired', () => {
  const cursor = (seq: number, ageDays: number): DeltaCursor => ({
    v: 1,
    kind: 'delta',
    seq,
    issuedAt: NOW.getTime() - ageDays * DAY,
  });

  it('trusts a cursor younger than the retention window even when the destination has no rows', () => {
    expect(deltaCursorExpired(cursor(500, 2), { now: NOW, retentionDays: 30, destinationMinSeq: null })).toBe(false);
    // A destination whose first retained row is far past the cursor is NOT a gap
    // while the cursor is young: seq is global, so other tenants filled the space.
    expect(deltaCursorExpired(cursor(5, 2), { now: NOW, retentionDays: 30, destinationMinSeq: 9_000 })).toBe(false);
  });

  it('keeps an old cursor while the destination still retains a row at or before it', () => {
    expect(deltaCursorExpired(cursor(100, 40), { now: NOW, retentionDays: 30, destinationMinSeq: 100 })).toBe(false);
    expect(deltaCursorExpired(cursor(100, 40), { now: NOW, retentionDays: 30, destinationMinSeq: 12 })).toBe(false);
  });

  it('expires an old cursor whose following rows may have been swept', () => {
    expect(deltaCursorExpired(cursor(100, 40), { now: NOW, retentionDays: 30, destinationMinSeq: 101 })).toBe(true);
    expect(deltaCursorExpired(cursor(100, 40), { now: NOW, retentionDays: 30, destinationMinSeq: null })).toBe(true);
  });

  it('checks retained rows inside the last margin day of the window', () => {
    const edge = 30 - CURSOR_RETENTION_MARGIN_DAYS;
    expect(deltaCursorExpired(cursor(1, edge - 0.01), { now: NOW, retentionDays: 30, destinationMinSeq: null })).toBe(false);
    expect(deltaCursorExpired(cursor(1, edge), { now: NOW, retentionDays: 30, destinationMinSeq: null })).toBe(true);
  });
});
