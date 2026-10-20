/**
 * The per-surface silence ceiling is in the candidate SQL, so LIMIT counts only
 * reapable rows: a crowd of live durable/container runs inside their larger ceiling
 * can no longer fill the batch and starve the dead ones.
 */
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { cloudPastCeiling } from './staleExecutionReaper';
import { cloudSilenceCeilingMs } from './orphanReasons';

describe('cloudPastCeiling', () => {
  it('compares last activity to the GitHub Actions cutoff for a GA-stamped run and the long-lived cutoff otherwise', () => {
    const nowMs = Date.parse('2026-10-19T12:00:00.000Z');
    const q = new PgDialect().sqlToQuery(cloudPastCeiling(nowMs));
    expect(q.sql).toContain('coalesce("executions"."updated_at", "executions"."created_at") < (case when');
    expect(q.sql).toContain('~');
    expect(q.params).toContain('"executor"[[:space:]]*:[[:space:]]*"github_actions"');
    expect(q.params).toContain(new Date(nowMs - cloudSilenceCeilingMs('github_actions')).toISOString());
    expect(q.params).toContain(new Date(nowMs - cloudSilenceCeilingMs(undefined)).toISOString());
  });
});
