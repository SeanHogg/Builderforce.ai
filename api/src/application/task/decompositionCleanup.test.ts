import { describe, expect, it } from 'vitest';
import { flagCleanupCandidates, type CleanupChildRow } from './decompositionCleanup';

/**
 * The rules that decide what a REVIEWER is offered. Everything here is about not
 * over-reaching: the flag is a heuristic about titles, so anything with a trace of
 * real work attached must fall out of the list before the heuristic ever runs.
 */

let seq = 0;
function child(partial: Partial<CleanupChildRow> & { title: string }): CleanupChildRow {
  seq += 1;
  return {
    id: partial.id ?? seq,
    parentTaskId: partial.parentTaskId ?? 100,
    title: partial.title,
    status: partial.status ?? 'backlog',
    createdAt: partial.createdAt ?? new Date(2026, 0, seq),
    runs: partial.runs ?? 0,
    pullRequests: partial.pullRequests ?? 0,
    comments: partial.comments ?? 0,
  };
}

describe('flagCleanupCandidates', () => {
  it('flags the markdown fragments the old decomposer created', () => {
    const flagged = flagCleanupCandidates([
      child({ id: 1, title: '**API Endpoints**:' }),
      child({ id: 2, title: '## Data model' }),
      child({ id: 3, title: 'Migrations' }),
      child({ id: 4, title: 'Add the capability entity and its migration' }),
    ]);
    expect(flagged.map((c) => c.taskId)).toEqual([1, 2, 3]);
    expect(flagged.every((c) => c.reason === 'not-a-work-item')).toBe(true);
  });

  it('keeps a label line whose CLAUSE is real work', () => {
    // `**Data Model**: create the Capability entity` survives the parser guard, so
    // the row it produced is a real ticket and must not be offered for archiving.
    const flagged = flagCleanupCandidates([
      child({ title: '**Data Model**: create the Capability entity' }),
    ]);
    expect(flagged).toEqual([]);
  });

  it('flags the LATER of two identical siblings and names the survivor', () => {
    const flagged = flagCleanupCandidates([
      child({ id: 10, title: 'Wire up the webhook receiver', createdAt: new Date(2026, 0, 1) }),
      child({ id: 11, title: 'Wire up the  Webhook Receiver', createdAt: new Date(2026, 0, 2) }),
    ]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.taskId).toBe(11);
    expect(flagged[0]!.reason).toBe('duplicate-sibling');
    expect(flagged[0]!.duplicateOfTaskId).toBe(10);
  });

  it('never flags a row that has a run, a PR or a comment attached', () => {
    const flagged = flagCleanupCandidates([
      child({ id: 20, title: '**API Endpoints**:', runs: 1 }),
      child({ id: 21, title: '**API Endpoints**:', pullRequests: 1 }),
      child({ id: 22, title: 'Migrations', comments: 3 }),
    ]);
    expect(flagged).toEqual([]);
  });

  it('keeps the FIRST copy even when the later one is the empty duplicate', () => {
    // The survivor is decided by age across ALL siblings, so a duplicate is never
    // merged into a newer empty twin.
    const flagged = flagCleanupCandidates([
      child({ id: 30, title: 'Ship the importer', createdAt: new Date(2026, 0, 1), pullRequests: 1 }),
      child({ id: 31, title: 'Ship the importer', createdAt: new Date(2026, 0, 5) }),
    ]);
    expect(flagged.map((c) => c.taskId)).toEqual([31]);
    expect(flagged[0]!.duplicateOfTaskId).toBe(30);
  });

  it('prefers "not a work item" over "duplicate" when both hold', () => {
    const flagged = flagCleanupCandidates([
      child({ id: 40, title: '**API Endpoints**:', createdAt: new Date(2026, 0, 1) }),
      child({ id: 41, title: '**API Endpoints**:', createdAt: new Date(2026, 0, 2) }),
    ]);
    expect(flagged.map((c) => c.reason)).toEqual(['not-a-work-item', 'not-a-work-item']);
  });

  it('carries the zero evidence so the reviewer sees the proof, not just the verdict', () => {
    const flagged = flagCleanupCandidates([child({ id: 50, title: 'Migrations' })]);
    expect(flagged[0]!.evidence).toEqual({ runs: 0, pullRequests: 0, comments: 0 });
  });
});
