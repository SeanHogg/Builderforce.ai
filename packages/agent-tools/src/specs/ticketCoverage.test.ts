import { describe, expect, it } from 'vitest';
import type { SpecOpenItem } from './specOpenItems';
import { codeChangeTicketTitle, isCodeChangeBackstopTitle, isMatchableSpecItemId, specTicketCoverage } from './ticketCoverage';

const item = (id: string, title: string, status: SpecOpenItem['status'] = 'incomplete'): SpecOpenItem =>
  ({ id, title, status, section: 'Features and tasks — status', line: 1 });

describe('specTicketCoverage', () => {
  it('regression: chat #157440 — a backstop code-change ticket never covers a spec row', () => {
    const out = specTicketCoverage(
      [item('P25-09', 'Slice D benchmark seeds for the other eight verticals')],
      [{ id: 7001, title: 'Code change (4 files) from Brain chat #157440', status: 'in_review' },
        { id: 7002, title: 'Code change (8 files)', description: 'P25-09', status: 'done' },
        { id: 7003, title: 'P25-09 seeds', status: 'todo', isBackstop: true }],
    );
    expect(out.covered).toEqual([]);
    expect(out.missing.map((i) => i.id)).toEqual(['P25-09']);
  });

  it('matches by the id as a whole token in the title or description', () => {
    const out = specTicketCoverage(
      [item('P25-09', 'Slice D seeds'), item('OUT-02', 'Sales brief export'), item('§6.6', 'FinanceLens')],
      [{ id: 1, title: '[P25-09] Seed the verticals', status: 'todo' },
        { id: 2, title: 'Exports', description: 'Implements OUT-02 of measure.md', status: 'in_progress' },
        { id: 3, title: 'P25-091 is something else', status: 'todo' },
        { id: 4, title: 'Section §6.61 work', status: 'todo' }],
    );
    expect(out.covered).toEqual([{ itemId: 'P25-09', ticketIds: [1] }, { itemId: 'OUT-02', ticketIds: [2] }]);
    expect(out.missing.map((i) => i.id)).toEqual(['§6.6']);
  });

  it('matches by the near-duplicate title rule when no id is written', () => {
    const out = specTicketCoverage(
      [item('fix-login-redirect-loop', 'Fix login redirect loop')],
      [{ id: 'a', title: 'Login redirect loop needs fixing', status: 'backlog' },
        { id: 'b', title: 'Fix signup redirect loop', status: 'backlog' }],
    );
    expect(out.covered).toEqual([{ itemId: 'fix-login-redirect-loop', ticketIds: ['a'] }]);
  });

  it('needs no ticket for a complete or unknown item; a blocked item may be covered by a blocked ticket', () => {
    const out = specTicketCoverage(
      [item('P25-01', 'Presets', 'complete'), item('P25-02', 'Odd', 'unknown'), item('P33-01', 'Event lake', 'blocked')],
      [{ id: 9, title: 'P33-01 event lake — operator provisions the pipeline', status: 'blocked' }],
    );
    expect(out).toEqual({ covered: [{ itemId: 'P33-01', ticketIds: [9] }], missing: [] });
  });

  it('a cancelled ticket covers nothing', () => {
    const out = specTicketCoverage([item('OUT-03', 'Bind traffic', 'blocked')], [{ id: 1, title: 'OUT-03', status: 'cancelled' }]);
    expect(out.missing.map((i) => i.id)).toEqual(['OUT-03']);
  });
});

describe('specTicketCoverage — id matching rules', () => {
  it('matches a short token case-sensitively, a long token case-insensitively', () => {
    const out = specTicketCoverage(
      [item('S3', 'Lifecycle'), item('B4', 'Seeds'), item('OUT-02', 'Export')],
      [{ id: 1, title: 'move the s3 bucket', status: 'todo' },
        { id: 2, title: 'B4: seeds', status: 'todo' },
        { id: 3, title: 'out-02 export work', status: 'todo' }],
    );
    expect(out.covered).toEqual([{ itemId: 'B4', ticketIds: [2] }, { itemId: 'OUT-02', ticketIds: [3] }]);
    expect(out.missing.map((i) => i.id)).toEqual(['S3']);
  });

  it('never matches a derived slug id by name', () => {
    expect(isMatchableSpecItemId('a1-first-2')).toBe(false);
    expect(isMatchableSpecItemId('make/the-gap')).toBe(true);
    expect(isMatchableSpecItemId('P25-09')).toBe(true);
    const out = specTicketCoverage([item('wire-the-probe', 'Wire the PreFetch probe')], [{ id: 1, title: 'Unrelated', description: 'wire-the-probe', status: 'todo' }]);
    expect(out.missing.map((i) => i.id)).toEqual(['wire-the-probe']);
  });

  it('lists a ticket once when it arrives as two rows (listing + filing)', () => {
    const out = specTicketCoverage([item('P25-09', 'Seeds')], [
      { id: 7, title: 'Seed the verticals', status: 'todo' },
      { id: 7, title: 'P25-09: Seeds', status: 'todo' },
      { id: 8, title: 'P25-09 follow-up', status: 'todo' },
    ]);
    expect(out.covered).toEqual([{ itemId: 'P25-09', ticketIds: [7, 8] }]);
  });
});

describe('the code-change backstop title', () => {
  it('builds and recognises the minted and re-titled forms', () => {
    expect(codeChangeTicketTitle(1, 'Brain chat #7')).toBe('Code change (1 file) from Brain chat #7');
    expect(codeChangeTicketTitle(8)).toBe('Code change (8 files)');
    expect(isCodeChangeBackstopTitle('Code change (3 files) from a local editor chat')).toBe(true);
    expect(isCodeChangeBackstopTitle('Code change (8 files)')).toBe(true);
    expect(isCodeChangeBackstopTitle('Code change for P25-09')).toBe(false);
  });
});
