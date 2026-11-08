import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { runGovernanceAuditor } from './governanceAuditor';

/** Renders each statement the auditor sends, and answers with no rows. */
function recordingDb() {
  const dialect = new PgDialect();
  const statements: string[] = [];
  const db = {
    execute: async (q: Parameters<PgDialect['sqlToQuery']>[0]) => {
      statements.push(dialect.sqlToQuery(q).sql);
      return { rows: [] };
    },
  };
  return { db: db as never, statements };
}

describe('governance auditor', () => {
  it('only raises a gap for a subject that does not already have an OPEN one, so a capped backlog drains', async () => {
    const { db, statements } = recordingDb();
    await runGovernanceAuditor(db, new Date('2026-11-08T00:00:00Z'));

    const raising = statements.filter((s) => s.includes('INSERT INTO governance_audit_gaps'));
    expect(raising).toHaveLength(3);
    for (const sql of raising) {
      // every candidate query excludes subjects with an open gap of the same type...
      expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM governance_audit_gaps g/);
      expect(sql).toMatch(/g\.status = 'open'/);
      // ...and is bounded, so the exclusion is what lets the NEXT batch reach new subjects
      expect(sql).toMatch(/LIMIT \$\d+/);
    }
    // each gap type excludes only ITS OWN open gaps
    expect(raising.filter((s) => s.includes("g.gap_type = 'merged_pr_unscanned'"))).toHaveLength(1);
    expect(raising.filter((s) => s.includes("g.gap_type = 'merged_pr_unreviewed'"))).toHaveLength(1);
    expect(raising.filter((s) => s.includes("g.gap_type = 'control_no_evidence'"))).toHaveLength(1);
  });

  it('closes a gap whose scan or evidence has since arrived, and reopens a recurring one', async () => {
    const { db, statements } = recordingDb();
    await runGovernanceAuditor(db);
    expect(statements.some((s) => /UPDATE governance_audit_gaps g SET status = 'resolved'/.test(s))).toBe(true);
    expect(statements.some((s) => /DO UPDATE\s+SET status = 'open'[\s\S]*WHERE governance_audit_gaps\.status = 'resolved'/.test(s))).toBe(true);
  });
});
