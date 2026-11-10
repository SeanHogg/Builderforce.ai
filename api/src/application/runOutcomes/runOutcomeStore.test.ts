import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { carryStoredEvent, upsertLabelRows, type LabelRow } from './runOutcomeStore';

/**
 * The label writer's precedence (PRD 41 §D1): an observed event (stored `value: true`) is never
 * erased by a later null/false. A final row closing a censored-true one lands its status,
 * window, version and computedAt, but keeps the stored value, event time and evidence.
 */

const at = (iso: string) => new Date(iso);

const storedCensoredTrue = {
  id: 1, tenantId: 7, runId: 'run-1', repository: 'https://github.com/acme/app', kind: 'reverted',
  value: true, status: 'censored', eventAt: at('2026-10-03T00:00:00Z'), windowEndsAt: at('2026-10-09T00:00:00Z'),
  evidence: { revert: 'cafe123' }, labellerVersion: 1, computedAt: at('2026-10-04T00:00:00Z'),
};

const incoming = (over: Partial<LabelRow> = {}): LabelRow => ({
  runId: 'run-1', repository: 'https://github.com/acme/app', kind: 'reverted',
  value: false, status: 'final', eventAt: null, windowEndsAt: at('2026-10-09T00:00:00Z'),
  evidence: {}, labellerVersion: 2, computedAt: at('2026-10-10T00:00:00Z'),
  ...over,
});

type Inserted = Array<Record<string, unknown>>;
const insertedLabels = (db: ReturnType<typeof fakeDb>): Inserted =>
  db.calls.filter((c) => c.kind === 'insert').flatMap((c) => c.payload as Inserted);

describe('upsertLabelRows — an observed event is never erased', () => {
  it('regression: a final false closing a censored true keeps value, eventAt and evidence', async () => {
    const db = fakeDb([[storedCensoredTrue], []]);
    expect(await upsertLabelRows(db as unknown as Db, 7, [incoming()])).toBe(1);
    expect(insertedLabels(db)).toEqual([expect.objectContaining({
      value: true, status: 'final', eventAt: at('2026-10-03T00:00:00Z'), evidence: { revert: 'cafe123' },
      labellerVersion: 2, computedAt: at('2026-10-10T00:00:00Z'),
    })]);
  });

  it('regression: a newer censored null never replaces a stored censored true', async () => {
    const db = fakeDb([[storedCensoredTrue]]);
    expect(await upsertLabelRows(db as unknown as Db, 7, [incoming({ status: 'censored', value: null })])).toBe(0);
    expect(insertedLabels(db)).toHaveLength(0);
  });

  it('regression: a newer final false never replaces a stored final true', async () => {
    const db = fakeDb([[{ ...storedCensoredTrue, status: 'final' }]]);
    expect(await upsertLabelRows(db as unknown as Db, 7, [incoming()])).toBe(0);
    expect(insertedLabels(db)).toHaveLength(0);
  });

  it('writes an incoming true over a stored null as it is', async () => {
    const db = fakeDb([[{ ...storedCensoredTrue, value: null, eventAt: null, evidence: {} }], []]);
    const row = incoming({ value: true, eventAt: at('2026-10-06T00:00:00Z'), evidence: { revert: 'beef' } });
    expect(await upsertLabelRows(db as unknown as Db, 7, [row])).toBe(1);
    expect(insertedLabels(db)).toEqual([expect.objectContaining({ value: true, eventAt: at('2026-10-06T00:00:00Z'), evidence: { revert: 'beef' } })]);
  });
});

describe('carryStoredEvent', () => {
  it('leaves the row untouched when nothing true is stored, or the row is itself true', () => {
    const row = incoming();
    expect(carryStoredEvent(undefined, row)).toBe(row);
    expect(carryStoredEvent({ ...storedCensoredTrue, value: null }, row)).toBe(row);
    const truthy = incoming({ value: true, eventAt: at('2026-10-05T00:00:00Z') });
    expect(carryStoredEvent(storedCensoredTrue, truthy)).toBe(truthy);
  });
});
