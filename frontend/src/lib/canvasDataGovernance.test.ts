/**
 * Governance is only worth having if it is HONEST and ENFORCED.
 *
 * Honest: detection reports a confidence, values beat names, and a flag column
 * called `bank_verified` is not tagged as financial data.
 * Enforced: what is tagged restricted is masked wherever it renders, and a
 * contract that is breached says which rule and by how many rows.
 */
import { describe, expect, it } from 'vitest';
import {
  classificationSummary,
  classifyColumn,
  classifyTabular,
  contractVerdict,
  evaluateDataContract,
  highestClassification,
  inferDataContract,
  maskCell,
  maskPlan,
  maskTabular,
  normalizeClassifications,
  normalizeDataContract,
} from './canvasDataGovernance';
import { profileTabular, type TabularSource } from './canvasTabularData';

const PEOPLE: TabularSource = {
  columns: ['id', 'full_name', 'contact', 'card', 'bank_verified', 'city'],
  rows: [
    { id: '1', full_name: 'Ada Lovelace', contact: 'ada@example.com', card: '4111111111111111', bank_verified: 1, city: 'London' },
    { id: '2', full_name: 'Alan Turing', contact: 'alan@example.com', card: '4222222222222', bank_verified: 0, city: 'Wilmslow' },
    { id: '3', full_name: 'Grace Hopper', contact: 'grace@example.com', card: '4333333333333', bank_verified: 1, city: 'New York' },
    { id: '4', full_name: 'Katherine J', contact: 'kj@example.com', card: '4444444444444', bank_verified: 0, city: 'Newport News' },
  ],
};

describe('classifyColumn', () => {
  it('believes VALUES over the column name', () => {
    // Nothing about "contact" says email; the values do.
    const tag = classifyColumn('contact', PEOPLE.rows);
    expect(tag.pii).toBe('email');
    expect(tag.confidence).toBe('high');
    expect(tag.reason).toBe('value-match');
  });

  it('does not tag a low-cardinality numeric flag as financial data', () => {
    const profiles = profileTabular(PEOPLE);
    const tag = classifyColumn('bank_verified', PEOPLE.rows, profiles.find((profile) => profile.name === 'bank_verified'));
    expect(tag.pii).toBe('none');
  });

  it('marks the categories that must never render in the clear', () => {
    expect(classifyColumn('card', PEOPLE.rows).masked).toBe(true);
    expect(classifyColumn('full_name', PEOPLE.rows).masked).toBe(false);
  });

  it('reports low confidence for a name-only match with no rows to check', () => {
    const tag = classifyColumn('home_address');
    expect(tag.pii).toBe('address');
    expect(tag.confidence).toBe('low');
  });
});

describe('classifyTabular + summary', () => {
  it('summarizes what a board would be sharing', () => {
    const tags = classifyTabular(PEOPLE, profileTabular(PEOPLE));
    const summary = classificationSummary(tags);
    expect(summary.total).toBe(6);
    expect(summary.piiColumns).toBeGreaterThanOrEqual(3);
    expect(summary.highest).toBe('restricted');
    expect(summary.categories).toContain('financial');
  });
});

describe('highestClassification', () => {
  it('takes the strictest, not the last', () => {
    expect(highestClassification(['public', 'restricted', 'internal'])).toBe('restricted');
    expect(highestClassification([])).toBe('public');
  });
});

describe('maskCell', () => {
  it('keeps the shape a reviewer needs and hides the rest', () => {
    expect(maskCell('ada@example.com', 'email')).toBe('a•••@example.com');
    expect(maskCell('4111111111111111', 'financial')).toBe('••••1111');
    expect(maskCell('Ada Lovelace', 'name')).toBe('AL•••');
    expect(maskCell('203.0.113.5', 'ip_address')).toBe('203.0.•.•');
  });

  it('keeps nothing at all for credentials', () => {
    expect(maskCell('hunter2', 'credentials')).toBe('••••••••');
  });

  it('leaves an empty cell empty rather than masking absence', () => {
    expect(maskCell('', 'email')).toBe('');
  });
});

describe('maskTabular', () => {
  it('masks only the columns that must be, and returns the SAME object when none are', () => {
    const tags = classifyTabular(PEOPLE, profileTabular(PEOPLE));
    const masked = maskTabular(PEOPLE, tags);
    expect(masked.rows[0]!.card).toBe('••••1111');
    // The email is confidential but not in the always-masked set, so it is intact
    // for analysis — the render path decides presentation, not the store.
    expect(masked.rows[0]!.contact).toBe('ada@example.com');
    expect(maskTabular(PEOPLE, [])).toBe(PEOPLE);
  });

  it('exposes the same plan the render path uses, so the two cannot disagree', () => {
    const plan = maskPlan(classifyTabular(PEOPLE, profileTabular(PEOPLE)));
    expect(plan.get('card')).toBe('financial');
    expect(plan.has('city')).toBe(false);
  });
});

describe('normalizeClassifications', () => {
  it('drops entries with no column and defaults an unknown category to none', () => {
    expect(normalizeClassifications([{ pii: 'email' }, { column: 'x', pii: 'nonsense' }])).toEqual([
      { column: 'x', classification: 'internal', pii: 'none', confidence: 'low', reason: 'default', masked: false },
    ]);
  });
});

describe('inferDataContract', () => {
  it('proposes required, unique and a natural key from what the data IS', () => {
    const contract = inferDataContract(PEOPLE, profileTabular(PEOPLE), classifyTabular(PEOPLE, profileTabular(PEOPLE)));
    expect(contract.primaryKey).toBeUndefined(); // several columns are unique — ambiguous, so nothing is asserted
    expect(contract.columns.find((column) => column.name === 'city')?.required).toBe(true);
    expect(contract.columns.find((column) => column.name === 'card')?.pii).toBe('financial');
  });

  it('names a single unambiguous key when there is exactly one', () => {
    const source: TabularSource = { columns: ['id', 'state'], rows: [{ id: 'a', state: 'x' }, { id: 'b', state: 'x' }] };
    const contract = inferDataContract(source, profileTabular(source));
    expect(contract.primaryKey).toEqual(['id']);
  });
});

describe('evaluateDataContract', () => {
  const contract = normalizeDataContract({
    columns: [
      { name: 'id', type: 'text', required: true, unique: true },
      { name: 'amount', type: 'number', min: 0, max: 100 },
      { name: 'state', type: 'text', allowedValues: ['open', 'closed'] },
      { name: 'missing_here', type: 'text' },
    ],
    primaryKey: ['id'],
    rowCountMin: 3,
    freshnessHours: 24,
  })!;

  const drifted: TabularSource = {
    columns: ['id', 'amount', 'state', 'surprise'],
    rows: [
      { id: 'a', amount: 5, state: 'open', surprise: 'x' },
      { id: 'a', amount: 500, state: 'archived', surprise: 'y' },
    ],
  };

  it('names every rule that broke, with counts rather than prose', () => {
    const violations = evaluateDataContract(drifted, contract, { fetchedAt: '2020-01-01T00:00:00.000Z', now: Date.parse('2020-01-05T00:00:00.000Z') });
    const rules = violations.map((violation) => violation.rule);
    expect(rules).toContain('missing-column');
    expect(rules).toContain('unexpected-column');
    expect(rules).toContain('not-unique');
    expect(rules).toContain('out-of-range');
    expect(rules).toContain('disallowed-value');
    expect(rules).toContain('row-count');
    expect(rules).toContain('primary-key-duplicate');
    expect(rules).toContain('stale');
    expect(violations.find((violation) => violation.rule === 'not-unique')?.detail.duplicates).toBe(1);
  });

  it('passes clean data and reports the verdict', () => {
    const clean: TabularSource = {
      columns: ['id', 'amount', 'state', 'missing_here'],
      rows: [
        { id: 'a', amount: 5, state: 'open', missing_here: '1' },
        { id: 'b', amount: 6, state: 'closed', missing_here: '2' },
        { id: 'c', amount: 7, state: 'open', missing_here: '3' },
      ],
    };
    const violations = evaluateDataContract(clean, contract, { fetchedAt: new Date().toISOString() });
    expect(violations).toEqual([]);
    expect(contractVerdict(violations)).toBe('pass');
  });

  it('grades an error-free but warned evaluation as warn, not fail', () => {
    expect(contractVerdict([{ severity: 'warning', rule: 'stale', detail: {} }])).toBe('warn');
    expect(contractVerdict([{ severity: 'error', rule: 'not-unique', detail: {} }])).toBe('fail');
  });

  it('does not report staleness when nothing recorded when the data was read', () => {
    const violations = evaluateDataContract({ columns: ['id'], rows: [{ id: 'a' }] }, normalizeDataContract({ columns: [{ name: 'id', type: 'text' }], freshnessHours: 1 })!, { fetchedAt: null });
    expect(violations.map((violation) => violation.rule)).not.toContain('stale');
  });
});
