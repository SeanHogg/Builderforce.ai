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
    // Round D: the scan is value-agnostic about HOW the column is reached, not only about what is written to it.
    ['a conditional spread of an identifier', `await db.update(executions).set({ updatedAt: now, ...(cond ? patch : {}) }).where(eq(executions.id, id));`],
    ['a parenthesised identifier spread', `await db.update(executions).set({ ...(patch), updatedAt: now }).where(eq(executions.id, id));`],
    ['an opaque spread inside a literal that is itself spread (any depth)', `await db.update(executions).set({ ...(done ? { completedAt: now, ...extra } : {}) }).where(eq(executions.id, id));`],
    ['a spread of a call', `await db.update(executions).set({ ...buildPatch(run), updatedAt: now }).where(eq(executions.id, id));`],
    ['a conditional .set() argument with an opaque branch', `await db.update(executions).set(done ? { completedAt: now } : patch).where(eq(executions.id, id));`],
    ['raw SQL with an interpolated table', 'await db.execute(sql`UPDATE ${executions} SET status = ${s} WHERE id = ${id}`);'],
    ['raw SQL with a schema-qualified interpolated table', 'await db.execute(sql`UPDATE ${schema.executions} AS e SET status = ${s} WHERE e.id = ${id}`);'],
    ['raw SQL with a quoted status column', 'await db.execute(sql`UPDATE executions SET "status" = ${s} WHERE id = ${id}`);'],
    ['raw SQL with an interpolated status column', 'await db.execute(sql`UPDATE executions SET ${executions.status} = ${s} WHERE id = ${id}`);'],
    ['an aliased table (const)', "const t = executions;\nawait db.update(t).set({ status: 'failed' }).where(eq(t.id, id));"],
    ['an aliased table (alias of an alias)', 'const t = schema.executions;\nconst u = t;\nawait db.update(u).set({ status }).where(eq(u.id, id));'],
    ['an aliased table (import as)', "import { executions as runs } from './schema';\nawait db.update(runs).set({ status: 'failed' }).where(eq(runs.id, id));"],
    ['an aliased table (destructure rename)', 'const { executions: runs } = schema;\nawait db.update(runs).set({ ...patch }).where(eq(runs.id, id));'],
    ['a write after a // inside a string on the same line (not a comment)', 'const url = \'https://x.io/a\'; await db.update(executions).set({ status: next }).where(w);\nconst s = "a // b"; await db.update(executions).set({ status: next }).where(w);'],
    ['a write after a // inside a template hole', 'const q = `${"//"}`; await db.update(executions).set({ status: next }).where(w);'],
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
    ['a conditional spread of literals that leave status alone', `await db.update(executions).set({ updatedAt: now, ...(done ? { completedAt: now } : {}) }).where(eq(executions.id, id));`],
    ['a spread inside a value (it is not spread into the set object)', `await db.update(executions).set({ payload: JSON.stringify({ ...payload, ...(x ? y : {}) }) }).where(eq(executions.id, id));`],
    ['a "..." in a string value', `await db.update(executions).set({ result: text.slice(0, 10) + '...' }).where(eq(executions.id, id));`],
    ['an apostrophe in a comment before the write', "// don't touch the status here\nawait db.update(executions).set({ payload: p }).where(eq(executions.id, id));"],
    ['an alias of another table', "const t = tasks;\nawait db.update(t).set({ status: 'done' }).where(eq(t.id, id));"],
    ['raw SQL on a column that merely ends in status', 'await db.execute(sql`UPDATE executions SET review_status = ${s} WHERE id = ${id}`);'],
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
