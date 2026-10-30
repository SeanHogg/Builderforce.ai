/**
 * Self-test of `check:execution-landing`'s scanner (api/scripts/lib/executionLandingScan.mjs): the guard must catch EVERY shape of a
 * status write to `executions` (value-agnostic - a non-terminal `'paused'` clobbers a cancelled row as surely as `'failed'` would) and
 * must stay quiet about writes that leave the column alone.
 */
import { describe, expect, it } from 'vitest';
import { scanExecutionStatusWrites } from '../../../scripts/lib/executionLandingScan.mjs';

const flagged = (source: string) => scanExecutionStatusWrites(source).length;

describe('check:execution-landing scanner', () => {
  it.each([
    ['a terminal literal', `await db.update(executions).set({ status: 'failed', errorMessage }).where(eq(executions.id, id));`],
    ['a NON-terminal literal (the CloudRunnerDO pause form)', `await this.db.update(executions)\n  .set({ status: 'paused', updatedAt: new Date() })\n  .where(eq(executions.id, cursor.executionId));`],
    ['a variable value', `await db.update(executions).set({ status: next, updatedAt: now }).where(eq(executions.id, id));`],
    ['a namespaced table', `await db.update(schema.executions).set({ status: ExecutionStatus.RUNNING }).where(eq(schema.executions.id, id));`],
    ['the repository table alias', `await db.update(executionsTable).set({ status }).where(eq(executionsTable.id, id));`],
    ['a status nested in a conditional spread (nested braces)', `await db.update(executions).set({ updatedAt: now, ...(done ? { completedAt: now, status: 'completed' } : {}) }).where(eq(executions.id, id));`],
    ['a quoted / computed key', `await db.update(executions).set({ ['status']: 'cancelled' }).where(eq(executions.id, id));\nawait db.update(executions).set({ [executions.status.name]: 'x' }).where(eq(executions.id, id));`],
    ['a .set() that is not an object literal (cannot be proven to leave status alone)', `await db.update(executions).set(patch).where(eq(executions.id, id));`],
    ['an identifier spread (opaque)', `await db.update(executions).set({ ...patch, updatedAt: now }).where(eq(executions.id, id));`],
    ['raw SQL', `await db.execute(sql\`UPDATE executions SET status = 'failed' WHERE id = \${id}\`);`],
    ['schema-qualified, quoted, aliased raw SQL', `await db.execute(sql\`UPDATE public."executions" AS e SET updated_at = now(), status = \${s} WHERE e.id = \${id}\`);`],
    ['lower-case raw SQL with an alias', `const q = 'update executions x set status=$1 where x.id=$2';`],
  ])('flags %s', (_name, source) => {
    expect(flagged(source)).toBeGreaterThan(0);
  });

  it.each([
    ['a payload write', `await db.update(executions).set({ payload: JSON.stringify({ ...payload, sourceSha }) }).where(eq(executions.id, id));`],
    ['a heartbeat', `await db.update(executions).set({ updatedAt: new Date(now) }).where(eq(executions.id, id));`],
    ['a column whose name merely ends in status', `await db.update(executions).set({ reviewStatus: 'x', jobStatus }).where(eq(executions.id, id));`],
    ['a status in the WHERE only', `await db.update(executions).set({ payload: p }).where(and(eq(executions.id, id), eq(executions.status, 'running')));`],
    ['an update of another table', `await db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, id));`],
    ['a mention in a comment', `// never db.update(executions).set({ status: 'failed' }) here\n/* UPDATE executions SET status = 'x' */\nconst a = 1;`],
    ['raw SQL that leaves status alone', `await db.execute(sql\`UPDATE executions SET result = left(result, 10) WHERE id IN (SELECT id FROM executions WHERE status IN ('failed'))\`);`],
  ])('does not flag %s', (_name, source) => {
    expect(flagged(source)).toBe(0);
  });

  it('reports each offending statement with a snippet the per-site allow-list can match', () => {
    const hits = scanExecutionStatusWrites(`db.update(executions).set({ status: 'paused' }).where(x);`);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.snippet).toContain("status: 'paused'");
  });
});
