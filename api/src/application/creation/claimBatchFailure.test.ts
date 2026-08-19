import { describe, expect, it } from 'vitest';
import {
  describeClaimBatchFailure,
  distinctIdCounts,
  pgFailureDetail,
  type PlannedClaimWrite,
} from './creationSessionRouteService';

/**
 * The claim's 500 could only ever be reasoned about by inference: `db.batch` on
 * neon-http reports one Postgres message for the whole batch and no statement
 * index, so `creation_session_objects_pkey` named a table and nothing else.
 *
 * These tests pin the two things that make the next occurrence readable — that a
 * constraint name is mapped back to the statement that carried it, and that a
 * case-only id collision is DISTINGUISHABLE from every other cause.
 */

const plan: PlannedClaimWrite[] = [
  { table: 'creation_sessions', rows: 1, statement: null },
  { table: 'creation_session_members', rows: 1, statement: null },
  { table: 'creation_session_claims', rows: 1, statement: null },
  { table: 'creation_session_events', rows: 1, statement: null },
  { table: 'creation_session_snapshots', rows: 1, statement: null },
  { table: 'creation_session_objects', rows: 12, statement: null },
];

describe('pgFailureDetail', () => {
  it('reads the constraint the driver names in the message', () => {
    const error = new Error('duplicate key value violates unique constraint "creation_session_objects_pkey"');
    expect(pgFailureDetail(error).constraint).toBe('creation_session_objects_pkey');
  });

  it('prefers a structured `constraint` field over the message when the driver supplies one', () => {
    const error = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_creation_events_revision' });
    expect(pgFailureDetail(error)).toEqual({ code: '23505', constraint: 'uq_creation_events_revision' });
  });

  it('reports null rather than guessing when nothing names a constraint', () => {
    expect(pgFailureDetail(new Error('connection reset'))).toEqual({ code: null, constraint: null });
  });
});

describe('describeClaimBatchFailure', () => {
  it('maps a constraint back to the statement that carried it, with its row count', () => {
    const error = new Error('duplicate key value violates unique constraint "creation_session_objects_pkey"');
    const report = describeClaimBatchFailure(error, plan);
    expect(report.statementIndex).toBe(5);
    expect(report.statementTable).toBe('creation_session_objects');
    expect(report.statementRows).toBe(12);
    expect(report.statementCount).toBe(6);
  });

  it('says the index is unknown rather than asserting one, when the constraint matches nothing', () => {
    const error = Object.assign(new Error('nope'), { constraint: 'some_other_table_pkey' });
    const report = describeClaimBatchFailure(error, plan);
    expect(report.statementIndex).toBeNull();
    expect(report.statementTable).toBeNull();
  });

  it('carries the whole plan, so a report is readable without the source', () => {
    const report = describeClaimBatchFailure(new Error('x'), plan);
    expect(report.plan).toContain('creation_session_objects:12');
  });
});

describe('distinctIdCounts', () => {
  it('separates a case-only collision from genuinely distinct ids', () => {
    // The one cause of creation_session_objects_pkey that has actually been found
    // and fixed: `UUID_RE` accepts either case and the `uuid` column does not
    // distinguish them, so a case-SENSITIVE Set validated these as two rows and
    // Postgres rejected them as one.
    const sameRowTwice = distinctIdCounts([
      '3F2504E0-4F89-11D3-9A0C-0305E82C3301',
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    ]);
    expect(sameRowTwice).toEqual({ total: 2, distinct: 2, distinctCaseless: 1 });
  });

  it('reports all three counts equal when the ids really are distinct', () => {
    expect(distinctIdCounts(['a', 'b', 'c'])).toEqual({ total: 3, distinct: 3, distinctCaseless: 3 });
  });

  it('handles an empty graph without a special case at the call site', () => {
    expect(distinctIdCounts([])).toEqual({ total: 0, distinct: 0, distinctCaseless: 0 });
  });
});
