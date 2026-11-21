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

  it('suffixes a repeated slug id (a short token with no separator is not an id)', () => {
    const items = parseSpecOpenItems('- [ ] A1 first\n- [ ] A1 first');
    expect(items.map((i) => i.id)).toEqual(['a1-first', 'a1-first-2']);
  });
});

describe('parseSpecOpenItems — a repeated token is ONE item', () => {
  it('merges a summary table and a detail table: most-open status, longer title, first line, any blocker', () => {
    const items = parseSpecOpenItems([
      '## Summary',
      '| ID | Item | Status |', '|---|---|---|',
      '| P25-09 | Seeds | Complete |',
      '## Detail',
      '| ID | Item | Status |', '|---|---|---|',
      '| P25-09 | Slice D benchmark seeds for the other verticals | Blocked — operator |',
    ].join('\n'));
    expect(items).toEqual([{
      id: 'P25-09', title: 'Slice D benchmark seeds for the other verticals', status: 'blocked', section: 'Summary', line: 4, blocker: 'operator',
    }]);
  });

  it('merges a checklist token listed twice instead of suffixing it', () => {
    const items = parseSpecOpenItems('- [x] P1: Fix login\n- [ ] P1: Fix signup flow');
    expect(items).toEqual([{ id: 'P1', title: 'P1: Fix signup flow', status: 'incomplete', section: '', line: 1 }]);
  });

  it('keeps the most-open status in the order blocked > incomplete > unknown > complete', () => {
    const one = (a: string, b: string) => parseSpecOpenItems(['| ID | Item | Status |', '|---|---|---|', `| X-1 | t | ${a} |`, `| X-1 | t | ${b} |`].join('\n'))[0]!.status;
    expect(one('Done', 'Someday')).toBe('unknown');
    expect(one('Someday', 'Open')).toBe('incomplete');
    expect(one('Open', 'Blocked')).toBe('blocked');
    expect(one('Blocked', 'Done')).toBe('blocked');
  });
});

describe('parseSpecOpenItems — leading tokens in checklists and bullets', () => {
  it('a short token is an id only when a separator follows it', () => {
    const ids = parseSpecOpenItems([
      '- [ ] S3 bucket lifecycle policy',
      '- [ ] B4: benchmark seeds',
      '- [ ] C2 — exit waterfall',
      '- [ ] D5 - market size',
      '- [ ] E6) heatmaps',
      '- [ ] F7. replay',
      '- [ ] **G8**: bold id',
      '- [ ] OUT-02 sales brief export',
      '- [ ] §6.6 FinanceLens',
    ].join('\n')).map((i) => i.id);
    expect(ids).toEqual(['s3-bucket-lifecycle-policy', 'B4', 'C2', 'D5', 'E6', 'F7', 'G8', 'OUT-02', '§6.6']);
  });

  it('a table title column still reads a leading short token', () => {
    expect(parseSpecOpenItems('| Item | State |\n|---|---|\n| B4 benchmark seeds | Open |')[0]!.id).toBe('B4');
  });
});

describe('parseSpecOpenItems — gap register sub-items', () => {
  it('a checklist nested under a gap bullet belongs to the gap, not counted again', () => {
    const items = parseSpecOpenItems([
      '## Work',
      '- [ ] A real checklist item',
      '## Consolidated Gap Register',
      '## 🔨 Make — Build',
      '- **The PreFetch cache-hit is unmeasured.** Add the probe.',
      '  - [ ] Wire the probe',
      '  - [ ] Chart the hit rate',
    ].join('\n'));
    expect(items.map((i) => i.title)).toEqual(['A real checklist item', 'The PreFetch cache-hit is unmeasured']);
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

  it('classifies from the LEADING word or mark first, and reads negated blocked phrasings', () => {
    expect(classifySpecStatus('Complete (was blocked on infra)')).toEqual({ status: 'complete' });
    expect(classifySpecStatus('not blocked anymore')).toEqual({ status: 'incomplete' });
    expect(classifySpecStatus('No longer blocked — in review')).toEqual({ status: 'incomplete' });
    expect(classifySpecStatus('Unblocked')).toEqual({ status: 'incomplete' });
    expect(classifySpecStatus('Done — no open issues')).toEqual({ status: 'complete' });
    expect(classifySpecStatus('🟡')).toEqual({ status: 'incomplete' });
    expect(classifySpecStatus('🟡 partial rollout')).toEqual({ status: 'incomplete' });
    expect(classifySpecStatus('⚠️ needs review')).toEqual({ status: 'incomplete' });
    expect(classifySpecStatus('Not ported: the importer still lives in the old repo')).toEqual({ status: 'incomplete' });
    expect(classifySpecStatus('Shipped')).toEqual({ status: 'complete' });
    expect(classifySpecStatus('WIP')).toEqual({ status: 'incomplete' });
    expect(classifySpecStatus('Remaining')).toEqual({ status: 'incomplete' });
    expect(classifySpecStatus('TODO')).toEqual({ status: 'incomplete' });
    expect(classifySpecStatus('Blocked by credentials')).toEqual({ status: 'blocked', blocker: 'credentials' });
    expect(classifySpecStatus('Waiting — blocked on the vendor')).toEqual({ status: 'blocked', blocker: 'the vendor' });
  });

  it('a checklist item that says it is no longer blocked is not blocked', () => {
    expect(parseSpecOpenItems('- [ ] Stripe webhook, no longer blocked')[0]!.status).toBe('incomplete');
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
