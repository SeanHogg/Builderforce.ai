import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifySpecStatus, isSpecItemToken, parseSpecOpenItems, specItemsOwingTickets } from './specOpenItems';

describe('parseSpecOpenItems — status tables', () => {
  const md = [
    '# Spec',
    '',
    '## Features and tasks — status',
    '',
    '| ID | Feature / task | Spec § | Status | Evidence |',
    '|---|---|---|---|---|',
    '| P25-01 | Presets carry KPI tiles | §5.3 | Complete | `a.ts` |',
    '| P25-09 | Slice D benchmark seeds | §6.5 | Incomplete | none |',
    '| P25-14 | Design-partner proof | §7 | Blocked — operator | Business relationship |',
    '| OUT-03 | Bind live experiment traffic | rollout | Blocked | Blocker (verified 2026-11-21): no producer exists |',
    '| OUT-04 | Partial thing | rollout | Partially complete | |',
    '| OUT-05 | Marked done | rollout | ✅ | |',
    '| OUT-06 | Marked open | rollout | ❌ | |',
    '| OUT-07 | In flight | rollout | In progress | |',
    '| OUT-08 | Odd | rollout | Someday | |',
    '',
    '## Other table',
    '',
    '| KPI | Definition | Benchmark |',
    '|---|---|---|',
    '| NRR | net revenue retention | 110% |',
  ].join('\n');
  const items = parseSpecOpenItems(md);

  it('reads every row of a status table, with its id, section, line and status', () => {
    expect(items.map((i) => [i.id, i.status])).toEqual([
      ['P25-01', 'complete'], ['P25-09', 'incomplete'], ['P25-14', 'blocked'], ['OUT-03', 'blocked'],
      ['OUT-04', 'incomplete'], ['OUT-05', 'complete'], ['OUT-06', 'incomplete'], ['OUT-07', 'incomplete'], ['OUT-08', 'unknown'],
    ]);
    expect(items[1]).toMatchObject({ title: 'Slice D benchmark seeds', section: 'Features and tasks — status', line: 8 });
  });

  it('reads the blocker from the status cell, or from a stated `Blocker:` in the row', () => {
    expect(items[2]!.blocker).toBe('operator');
    expect(items[3]!.blocker).toBe('no producer exists');
    expect(items[1]!.blocker).toBeUndefined();
  });

  it('ignores a table with no status column', () => {
    expect(items.find((i) => i.title.includes('NRR'))).toBeUndefined();
  });

  it('a table keyed by an item column alone takes a leading token, else a slug', () => {
    const [a, b] = parseSpecOpenItems([
      '| Item | State |', '|---|---|', '| B4 benchmark seeds | Open |', '| Make the dashboard faster | Done |',
    ].join('\n'));
    expect(a).toMatchObject({ id: 'B4', status: 'incomplete' });
    expect(b).toMatchObject({ id: 'make-the-dashboard-faster', status: 'complete' });
  });
});

describe('parseSpecOpenItems — checklists', () => {
  it('reads `- [ ]` as incomplete and `- [x]` as complete, with tokens and blockers', () => {
    const items = parseSpecOpenItems([
      '## §6 Work',
      '- [ ] §6.6 FinanceLens reads the preset',
      '- [x] Release notes for slice B',
      '- [ ] Stripe webhook *Blocker: credentials.*',
      '```',
      '- [ ] not an item, in a fence',
      '```',
    ].join('\n'));
    expect(items).toEqual([
      { id: '§6.6', title: '§6.6 FinanceLens reads the preset', status: 'incomplete', section: '§6 Work', line: 2 },
      { id: 'release-notes-for-slice-b', title: 'Release notes for slice B', status: 'complete', section: '§6 Work', line: 3 },
      { id: 'stripe-webhook-blocker-credentials', title: 'Stripe webhook *Blocker: credentials.*', status: 'blocked', section: '§6 Work', line: 4, blocker: 'credentials.' },
    ]);
  });

  it('suffixes a repeated id', () => {
    const items = parseSpecOpenItems('- [ ] A1 first\n- [ ] A1 again');
    expect(items.map((i) => i.id)).toEqual(['A1', 'A1-2']);
  });
});

describe('parseSpecOpenItems — the gap register', () => {
  it('reads every gap as incomplete open work', () => {
    const items = parseSpecOpenItems([
      '## Consolidated Gap Register',
      '## 🔨 Make — Build',
      '- **The PreFetch cache-hit is unmeasured.** Add the probe. *Blocker: telemetry.*',
    ].join('\n'));
    expect(items).toEqual([{
      id: 'make/the-prefetch-cache-hit-is-unmeasured', title: 'The PreFetch cache-hit is unmeasured',
      status: 'incomplete', section: 'make', line: 3, blocker: 'telemetry',
    }]);
  });
});

describe('status and token helpers', () => {
  it('classifies status words and marks', () => {
    expect(classifySpecStatus('Incomplete').status).toBe('incomplete');
    expect(classifySpecStatus('**Done**').status).toBe('complete');
    expect(classifySpecStatus('Not done').status).toBe('incomplete');
    expect(classifySpecStatus('🚫 waiting').status).toBe('blocked');
  });

  it('knows a token from a slug', () => {
    for (const id of ['P25-09', 'OUT-02', 'B4', '§6.6', '§25a.3', 'C6.2']) expect(isSpecItemToken(id)).toBe(true);
    for (const id of ['release-notes', 'make/foo', 'Thing']) expect(isSpecItemToken(id)).toBe(false);
  });
});

describe('the real docs/specs/measure.md', () => {
  const markdown = readFileSync(fileURLToPath(new URL('../../../../docs/specs/measure.md', import.meta.url).href), 'utf8');
  const items = parseSpecOpenItems(markdown);
  const byId = new Map(items.map((i) => [i.id, i]));

  it('finds the status table rows (PRD 25, PRD 33, outcome metrics) under unique ids', () => {
    for (let n = 1; n <= 14; n++) expect(byId.has(`P25-${String(n).padStart(2, '0')}`)).toBe(true);
    for (const id of ['P33-01', 'P33-02', 'P33-03', 'OUT-01', 'OUT-02', 'OUT-03']) expect(byId.has(id)).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('reads every row with a known status, and the blocked rows as blocked', () => {
    const rows = items.filter((i) => /^(P25|P33|OUT)-\d\d$/.test(i.id));
    expect(rows.length).toBe(20);
    for (const row of rows) expect(row.status).not.toBe('unknown');
    expect(byId.get('P25-01')!.status).toBe('complete');
    for (const id of ['P25-14', 'P33-01', 'P33-02', 'P33-03']) expect(byId.get(id)).toMatchObject({ status: 'blocked', blocker: 'operator' });
    expect(byId.get('OUT-03')!.status).toBe('blocked');
    expect(specItemsOwingTickets(rows).map((i) => i.id)).toEqual(
      rows.filter((r) => r.status === 'incomplete' || r.status === 'blocked').map((r) => r.id),
    );
  });
});
