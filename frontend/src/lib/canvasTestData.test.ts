import { describe, it, expect } from 'vitest';
import { fixtureFromDataset, generateFixture, unmaskedSensitiveColumns } from './canvasTestData';
import type { DataContract } from './canvasDataGovernance';

const CONTRACT: DataContract = {
  columns: [
    { name: 'customer_id', type: 'text', required: true, unique: true },
    { name: 'email', type: 'text', required: true },
    { name: 'age', type: 'number', min: 18, max: 120 },
    { name: 'plan', type: 'text', allowedValues: ['free', 'pro', 'enterprise'] },
    { name: 'signed_up', type: 'date' },
  ],
  primaryKey: ['customer_id'],
};

describe('generateFixture', () => {
  const fixture = generateFixture(CONTRACT, { validRows: 3, includeHostileStrings: true });

  it('produces all three populations', () => {
    expect(fixture.counts.valid).toBe(3);
    expect(fixture.counts.boundary).toBeGreaterThan(0);
    expect(fixture.counts.invalid).toBeGreaterThan(0);
    expect(fixture.columns).toEqual(['customer_id', 'email', 'age', 'plan', 'signed_up']);
  });

  it('is deterministic — the same contract yields the same rows', () => {
    expect(generateFixture(CONTRACT, { validRows: 3, includeHostileStrings: true }).rows).toEqual(fixture.rows);
  });

  it('puts a value on both edges of a declared range', () => {
    const ages = fixture.cases.filter((item) => item.column === 'age').map((item) => item.row.age);
    expect(ages).toContain(18);
    expect(ages).toContain(120);
    expect(ages).toContain(17);  // belowMin — must be rejected
    expect(ages).toContain(121); // aboveMax — must be rejected
  });

  it('empties a required column and disallows an unlisted enum value', () => {
    const rules = fixture.cases.filter((item) => item.kind === 'invalid').map((item) => item.rule);
    expect(rules).toContain('requiredEmpty');
    expect(rules).toContain('disallowedValue');
    expect(rules).toContain('duplicateKey');
  });

  it('includes the string shapes naive validation breaks on', () => {
    const hostile = fixture.cases.filter((item) => item.rule === 'hostileString').map((item) => String(item.row.email));
    expect(hostile.some((value) => value.includes("O'Brien"))).toBe(true);
    expect(hostile.some((value) => value.includes('<script>'))).toBe(true);
    expect(hostile.some((value) => value.length > 300)).toBe(true);
  });

  it('keeps every cell a string or a number, as the tabular model requires', () => {
    for (const row of fixture.rows) {
      for (const value of Object.values(row)) {
        expect(['string', 'number']).toContain(typeof value);
      }
    }
  });

  it('honours the opt-outs', () => {
    const minimal = generateFixture(CONTRACT, { validRows: 2, includeBoundary: false, includeInvalid: false });
    expect(minimal.counts).toEqual({ valid: 2, boundary: 0, invalid: 0 });
  });
});

describe('fixtureFromDataset', () => {
  const source = {
    columns: ['name', 'email'],
    rows: [
      { name: 'Ada Lovelace', email: 'ada@example.com' },
      { name: 'Grace Hopper', email: 'grace@example.com' },
    ],
  };
  const classifications = [
    { column: 'name', classification: 'confidential' as const, pii: 'name' as const, confidence: 'high' as const, reason: 'name-match' as const, masked: true },
    { column: 'email', classification: 'confidential' as const, pii: 'email' as const, confidence: 'high' as const, reason: 'value-match' as const, masked: true },
  ];

  it('masks through the one masking rule the board already renders with', () => {
    const fixture = fixtureFromDataset(source, classifications);
    expect(fixture.rows[0]?.email).toBe('a•••@example.com');
    expect(String(fixture.rows[0]?.name)).not.toContain('Ada Lovelace');
  });

  it('caps the extract', () => {
    expect(fixtureFromDataset(source, classifications, 1).rows).toHaveLength(1);
  });
});

describe('unmaskedSensitiveColumns', () => {
  it('names the columns that would leave in the clear', () => {
    expect(unmaskedSensitiveColumns([
      { column: 'email', classification: 'confidential', pii: 'email', confidence: 'high', reason: 'value-match', masked: false },
      { column: 'plan', classification: 'internal', pii: 'none', confidence: 'low', reason: 'default', masked: false },
    ])).toEqual(['email']);
  });
});
