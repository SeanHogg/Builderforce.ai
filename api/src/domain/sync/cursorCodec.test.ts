import { describe, expect, it } from 'vitest';
import {
  CURSOR_RETENTION_MARGIN_DAYS,
  RESNAPSHOT_REQUIRED,
  decodeSyncCursor,
  deltaCursorExpired,
  encodeSyncCursor,
  type DeltaCursor,
} from './cursorCodec';
import type { SyncWatermark } from './deltaWatermark';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ISSUED = NOW.getTime() - 60_000;
const forged = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '');

describe('encodeSyncCursor / decodeSyncCursor', () => {
  it('round-trips a delta and a snapshot cursor, including seq 0 and a txid beyond 2^53', () => {
    const delta: DeltaCursor = { v: 2, kind: 'delta', txid: '9007199254740993', seq: 0, issuedAt: ISSUED };
    expect(decodeSyncCursor(encodeSyncCursor(delta))).toEqual(delta);
    const snapshot = {
      v: 2 as const,
      kind: 'snapshot' as const,
      afterEntityType: 'ticket',
      afterClientEntityId: 'b',
      tipTxid: '18446744073709551615',
      issuedAt: ISSUED,
    };
    expect(decodeSyncCursor(encodeSyncCursor(snapshot))).toEqual(snapshot);
  });

  it('keeps txid a string on the wire (never a JS number)', () => {
    const raw = encodeSyncCursor({ v: 2, kind: 'delta', txid: '9007199254740993', seq: 1, issuedAt: ISSUED });
    expect(JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (raw.length % 4)) % 4))).txid)
      .toBe('9007199254740993');
    expect(decodeSyncCursor(forged({ v: 2, kind: 'delta', txid: 9007199254740993, seq: 1, issuedAt: ISSUED }))).toBeNull();
  });

  it('reads a v1 delta cursor as a legacy cursor (translated by the pull) and never mints one', () => {
    expect(decodeSyncCursor(forged({ v: 1, kind: 'delta', seq: 42, issuedAt: ISSUED })))
      .toEqual({ v: 1, kind: 'delta', seq: 42, issuedAt: ISSUED });
  });

  it('resnapshots a v1 snapshot cursor: its tenant tip has no txid', () => {
    expect(decodeSyncCursor(forged({
      v: 1, kind: 'snapshot', afterEntityType: 'ticket', afterClientEntityId: 'a', tip: 42, issuedAt: ISSUED,
    }))).toBeNull();
  });

  it('is null — never sequence 0 — for anything it did not mint', () => {
    for (const raw of [
      undefined,
      null,
      '',
      '   ',
      '0',
      'not-a-cursor',
      'bfc1.3.abcdef01',
      forged({ v: 3, kind: 'delta', txid: '1', seq: 1, issuedAt: ISSUED }),
      forged({ v: 2, kind: 'delta', seq: 1, issuedAt: ISSUED }),
      forged({ v: 2, kind: 'delta', txid: '-1', seq: 1, issuedAt: ISSUED }),
      forged({ v: 2, kind: 'delta', txid: '18446744073709551616', seq: 1, issuedAt: ISSUED }),
      forged({ v: 2, kind: 'delta', txid: '1', seq: -1, issuedAt: ISSUED }),
      forged({ v: 2, kind: 'delta', txid: '1', seq: 1.5, issuedAt: ISSUED }),
      forged({ v: 2, kind: 'delta', txid: '1', seq: 1 }),
      forged({ v: 1, kind: 'delta', seq: -1, issuedAt: ISSUED }),
      forged({ v: 1, kind: 'delta', seq: 1.5, issuedAt: ISSUED }),
      forged({ v: 1, kind: 'delta', seq: 1 }),
      forged({ v: 2, kind: 'snapshot', afterEntityType: 'ticket', afterClientEntityId: 'a', issuedAt: ISSUED }),
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
  const at = (seq: number): SyncWatermark => ({ txid: '100', seq });
  const aged = (ageDays: number) => ({ issuedAt: NOW.getTime() - ageDays * DAY });
  const window = (destinationMin: SyncWatermark | null) => ({ now: NOW, retentionDays: 30, destinationMin });

  it('trusts a cursor younger than the retention window even when the destination has no rows', () => {
    expect(deltaCursorExpired(aged(2), at(500), window(null))).toBe(false);
    // A destination whose first retained row is far past the cursor is NOT a gap
    // while the cursor is young: other destinations filled the space.
    expect(deltaCursorExpired(aged(2), at(5), window({ txid: '900', seq: 9_000 }))).toBe(false);
  });

  it('keeps an old cursor while the destination still retains a row at or before it', () => {
    expect(deltaCursorExpired(aged(40), at(100), window(at(100)))).toBe(false);
    expect(deltaCursorExpired(aged(40), at(100), window(at(12)))).toBe(false);
    expect(deltaCursorExpired(aged(40), at(100), window({ txid: '99', seq: 500 }))).toBe(false);
  });

  it('expires an old cursor whose following rows may have been swept', () => {
    expect(deltaCursorExpired(aged(40), at(100), window(at(101)))).toBe(true);
    expect(deltaCursorExpired(aged(40), at(100), window({ txid: '101', seq: 1 }))).toBe(true);
    expect(deltaCursorExpired(aged(40), at(100), window(null))).toBe(true);
  });

  it('checks retained rows inside the last margin day of the window', () => {
    const edge = 30 - CURSOR_RETENTION_MARGIN_DAYS;
    expect(deltaCursorExpired(aged(edge - 0.01), at(1), window(null))).toBe(false);
    expect(deltaCursorExpired(aged(edge), at(1), window(null))).toBe(true);
  });
});
