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
    // Round E: how the table is spelled in update(...) / insert(...), computed keys, upserts, more raw SQL, regex literals.
    ['a cast table', "await db.update(executions as any).set({ status: 'failed' }).where(w);"],
    ['a parenthesised table', "await db.update((executions)).set({ status: 'failed' }).where(w);"],
    ['a non-null table', "await db.update(executions!).set({ status: 'failed' }).where(w);"],
    ['a bracket-access table', "await db.update(schema['executions']).set({ status: 'failed' }).where(w);"],
    ['a cast alias', "const t = executions;\nawait db.update(t as any).set({ status: 'failed' }).where(w);"],
    ['a computed key that is a variable (opaque)', 'await db.update(executions).set({ [col]: value }).where(w);'],
    ['a computed key that is an expression (opaque)', "await db.update(executions).set({ updatedAt: now, [prefix + 'tatus']: value }).where(w);"],
    ['an upsert that sets status', "await db.insert(executions).values(row).onConflictDoUpdate({ target: executions.id, set: { status: 'failed' } });"],
    ['an upsert through the repository alias with a conditional status', "await db.insert(executionsTable).values(row)\n  .onConflictDoUpdate({ target: executionsTable.id, set: { updatedAt: now, ...(done ? { status: 'completed' } : {}) } });"],
    ['an upsert whose set is not a literal', 'await db.insert(executions).values(row).onConflictDoUpdate({ target: executions.id, set: patch });'],
    ['an upsert whose set spreads something opaque', 'await db.insert(executions).values(row).onConflictDoUpdate({ target: executions.id, set: { ...patch } });'],
    ['an upsert of a cast table', "await db.insert(executions as any).values(row).onConflictDoUpdate({ target: id, set: { status: 'x' } });"],
    ['raw upsert (INSERT ... ON CONFLICT DO UPDATE SET status)', 'await db.execute(sql`INSERT INTO executions (id, status) VALUES (${id}, ${s}) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`);'],
    ['raw upsert into an interpolated table', 'await db.execute(sql`INSERT INTO ${executions} (id, status) VALUES (${id}, ${s}) ON CONFLICT (id) DO UPDATE SET updated_at = now(), status = ${s}`);'],
    ['raw UPDATE ONLY', "await db.execute(sql`UPDATE ONLY executions SET status = 'failed' WHERE id = ${id}`);"],
    ['raw SQL with a sql.identifier status column', "await db.execute(sql`UPDATE executions SET ${sql.identifier('status')} = ${s} WHERE id = ${id}`);"],
    ['raw SQL with a tuple assignment', "await db.execute(sql`UPDATE executions SET (status, updated_at) = ('failed', now()) WHERE id = ${id}`);"],
    ['raw SQL on an aliased table', 'const t = executions;\nawait db.execute(sql`UPDATE ${t} SET status = ${s} WHERE id = ${id}`);'],
    ['a write after a regex literal that ends in // on the same line', "const re = /a\\/\\//; await db.update(executions).set({ status: next }).where(w);"],
    ['a write after a division on the same line', 'const half = total / 2; const r = a / b; await db.update(executions).set({ status: next }).where(w);'],
    ['a write after a regex literal in a call', "const ok = /^https?:\\/\\//.test(url); await db.update(executions).set({ status: next }).where(w);"],
    // Round F: builders held in a variable, bracket access, bracket-access aliases, and opaque interpolated SET targets.
    ['a builder held in a variable', "const q = db.update(executions);\nawait q.set({ status: 'failed' }).where(w);"],
    ['a builder held in a variable, filtered before the set', 'const q = this.db.update(executions).where(w);\nawait q.set({ status });'],
    ['a builder held in a variable whose set is opaque', 'let q = db.update(executions);\nawait q.set(patch);'],
    ['a bracket-access alias of the table', "const t = schema['executions'];\nawait db.update(t).set({ status: 'failed' }).where(w);"],
    ['bracket-access update', "await db['update'](executions).set({ status: 'failed' }).where(w);"],
    ['bracket-access set', "await db.update(executions)['set']({ status: 'failed' }).where(w);"],
    ['bracket-access update held in a variable', "const q = db['update'](executions);\nawait q.set({ status: 'failed' });"],
    ['raw SQL whose assignment target is sql.identifier of a variable', 'await db.execute(sql`UPDATE executions SET ${sql.identifier(col)} = ${s} WHERE id = ${id}`);'],
    ['raw SQL whose assignment target is sql.raw of a variable', 'await db.execute(sql`UPDATE executions SET ${sql.raw(col)} = ${s} WHERE id = ${id}`);'],
    ['raw SQL whose whole SET list is interpolated', 'await db.execute(sql`UPDATE executions SET ${setClause} WHERE id = ${id}`);'],
    ['raw SQL with an opaque target after a plain one', 'await db.execute(sql`UPDATE executions SET result = ${r}, ${sql.identifier(col)} = ${s} WHERE id = ${id}`);'],
    ['raw SQL with an opaque target inside a tuple', 'await db.execute(sql`UPDATE executions SET (result, ${sql.identifier(col)}) = (${r}, ${s}) WHERE id = ${id}`);'],
    ['a raw upsert with an opaque interpolated target', 'await db.execute(sql`INSERT INTO executions (id) VALUES (${id}) ON CONFLICT (id) DO UPDATE SET ${sql.identifier(col)} = ${v}`);'],
    ['raw SQL whose target is sql.identifier of the status column', "await db.execute(sql`UPDATE executions SET ${sql.identifier('status')} = ${s} WHERE id = ${id}`);"],
    // Round G: assignment / parameter destructure aliases, generic calls, a stored builder's scope, a WHERE inside a ${} hole.
    ['an assignment-destructure alias', "let runs;\n({ executions: runs } = schema);\nawait db.update(runs).set({ status: 'failed' }).where(w);"],
    ['a function-parameter destructure alias', "async function land({ executions: t }: Schema) { await db.update(t).set({ status: 'failed' }).where(w); }"],
    ['an arrow-parameter destructure alias', "const land = async ({ executions: t }) => { await db.update(t).set({ status: 'failed' }).where(w); };"],
    ['a generic update call', "await db.update<typeof executions>(executions).set({ status: 'failed' }).where(w);"],
    ['a generic set call', "await db.update(executions).set<Patch>({ status: 'failed' }).where(w);"],
    ['a generic update held in a variable', "const q = db.update<Row>(executions);\nawait q.set<Row>({ status: 'failed' });"],
    ['a stored builder used inside a nested block of its scope', "const q = db.update(executions);\nif (go) {\n  await q.set({ status: 'failed' });\n}"],
    ['a stored builder whose name is also used for another binding LATER in the file', "function a() { const q = db.update(executions); return q.set({ status: 'failed' }); }\nfunction b() { const q = db.update(tasks); return q.set({ status: 'done' }); }"],
    ['a stored builder whose name is re-declared inside a nested arrow body', "const q = db.update(executions);\nconst h = () => { const q = db.select(); return q; };\nawait q.set({ status: 'failed' });"],
    ['a stored builder whose name appears in a destructure default in a nested function parameter list', "const q = db.update(executions);\nconst h = ({ q = 1 }) => q;\nawait q.set({ status: 'failed' });"],
    ['raw SQL whose opaque target follows a WHERE inside a ${} hole', 'await db.execute(sql`UPDATE executions SET result = ${cond ? sql`WHERE a` : sql`x`}, ${sql.identifier(col)} = ${v} WHERE id = ${id}`);'],
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
    ['a computed key that is provably another column', "await db.update(executions).set({ ['payload']: p, updatedAt: now }).where(eq(executions.id, id));"],
    ['an array value (a `[` that is not a key)', 'await db.update(executions).set({ tags: [a, b] }).where(eq(executions.id, id));'],
    ['an upsert that leaves status alone', 'await db.insert(executions).values(row).onConflictDoUpdate({ target: executions.id, set: { updatedAt: now, payload: p } });'],
    ['a plain insert (a new row is not a status overwrite)', "await db.insert(executions).values({ id, status: 'queued' });"],
    ['an upsert into another table', 'await db.insert(executionPauseState).values(row).onConflictDoUpdate({ target: executionPauseState.executionId, set: values });'],
    ['a table whose name merely starts with executions', "await db.update(executionsArchive).set({ status: 'x' }).where(w);"],
    ['raw upsert that leaves status alone', 'await db.execute(sql`INSERT INTO executions (id, result) VALUES (${id}, ${r}) ON CONFLICT (id) DO UPDATE SET result = EXCLUDED.result`);'],
    ['a regex literal with // inside it (not a comment) and no write', "const re = /a\\/\\//; const x = 1; // trailing comment\nawait db.update(tasks).set({ status: 'done' }).where(w);"],
    // Round F
    ['an object literal { executions: X } is not an alias (only a destructure is)', "const o = { executions: runs };\nawait db.update(runs).set({ status: 'x' }).where(w);"],
    ['an object-literal property in a call is not an alias', "register({ executions: runs });\nawait db.update(runs).set({ status: 'x' }).where(w);"],
    ['a builder held in a variable for another table', "const q = db.update(tasks);\nawait q.set({ status: 'x' }).where(w);"],
    ['a builder held in a variable whose set leaves status alone', 'const q = db.update(executions);\nawait q.set({ updatedAt: now }).where(w);'],
    ['a bracket-access alias of another table', "const t = schema['tasks'];\nawait db.update(t).set({ status: 'done' }).where(w);"],
    ['raw SQL whose assignment target is a provably other column (sql.identifier of a literal)', "await db.execute(sql`UPDATE executions SET ${sql.identifier('result')} = ${v} WHERE id = ${id}`);"],
    ['raw SQL whose assignment target is a provably other column (sql.raw of a literal)', "await db.execute(sql`UPDATE executions SET ${sql.raw('result')} = ${v} WHERE id = ${id}`);"],
    ['raw SQL whose assignment target is a provably other column (a table column)', 'await db.execute(sql`UPDATE executions SET ${executions.updatedAt} = now(), result = ${v} WHERE id = ${id}`);'],
    ['raw SQL with interpolations only in VALUES', 'await db.execute(sql`UPDATE executions SET result = ${r}, updated_at = ${now} WHERE id = ${id}`);'],
    ['a raw upsert with only provable targets', "await db.execute(sql`INSERT INTO executions (id) VALUES (${id}) ON CONFLICT (id) DO UPDATE SET ${sql.identifier('result')} = ${v}`);"],
    // Round G
    ['a builder of executions in one function, a same-named builder of another table in the next', "function a() { const q = db.update(executions); return q.where(w); }\nfunction b() { const q = db.update(tasks); return q.set({ status: 'done' }); }"],
    ['a stored builder re-bound to another table before its set', "let q = db.update(executions);\nq = db.update(tasks);\nawait q.set({ status: 'done' });"],
    ['a stored builder used after the block it was declared in closed (another binding by then)', "{ const q = db.update(executions); await q.where(w); }\nawait q.set({ status: 'done' });"],
    ['a destructure parameter of another table', "async function land({ tasks: t }: Schema) { await db.update(t).set({ status: 'done' }).where(w); }"],
    ['an object literal passed to a call whose result is a block body (not a parameter list)', "if (check({ executions: runs })) { await db.update(runs).set({ status: 'x' }).where(w); }"],
    ['a generic update of another table', "await db.update<typeof tasks>(tasks).set({ status: 'done' }).where(w);"],
    ['raw SQL with a WHERE inside a ${} hole and only provable targets', 'await db.execute(sql`UPDATE executions SET result = ${cond ? sql`WHERE a` : sql`x`}, ${sql.identifier(\'result\')} = ${v} WHERE id = ${id}`);'],
  ])('does not flag %s', (_name, source) => {
    expect(flagged(source)).toBe(0);
  });

  // KNOWN LIMIT (documented in the scan's header): a table that arrives as a function parameter cannot be resolved lexically - it is
  // flagged only when it is a resolvable alias of `executions`.
  it('does not see a table passed in as a function parameter, but does see an alias of executions', () => {
    expect(flagged("async function land(table: Table) { await db.update(table).set({ status: 'failed' }).where(w); }")).toBe(0);
    expect(flagged("const table = executions;\nasync function land() { await db.update(table).set({ status: 'failed' }).where(w); }")).toBeGreaterThan(0);
  });

  // KNOWN LIMITS (documented in the scan's header): a lexical pass cannot see these. Pinned here so a change that closes one is a
  // deliberate edit of this test and of the header, not an accident.
  it.each([
    ['raw SQL assembled by string concatenation', "await db.execute(sql.raw('UPDATE exec' + 'utions SET sta' + 'tus = 1'));"],
    ['a ; inside a SQL string literal before the status assignment', "await db.execute(sql`UPDATE executions SET note = 'a;b', status = 'x' WHERE id = ${id}`);"],
    ['a getter key', "await db.update(executions).set({ get status() { return 'x'; } }).where(w);"],
    ['a builder held in a field, not a variable', "this.q = db.update(executions);\nawait this.q.set({ status: 'failed' });"],
    ['a builder passed through a function', "run(db.update(executions));\nfunction run(q) { return q.set({ status: 'failed' }); }"],
  ])('documented limit, not flagged: %s', (_name, source) => {
    expect(flagged(source)).toBe(0);
  });

  // ACCEPTED OVER-FLAG: the rebind walk looks only at depth 0 of the builder's block, so an assignment-destructure that genuinely
  // rebinds the builder name (`({ q = 1 } = o)` assigns `q`) is not seen as the rebind it is - the builder's scope runs on and the
  // later `.set({ status })` is flagged though `q` no longer holds the builder. The scan errs toward flagging, never toward
  // missing a write; a real site like this takes the per-site allow-list. Pinned so closing it is a deliberate edit.
  it('over-flags (never under-flags) a genuine destructure rebind of a stored builder name', () => {
    expect(flagged("let q = db.update(executions);\n({ q = 1 } = o);\nawait q.set({ status: 'failed' });")).toBeGreaterThan(0);
  });

  it('reports each offending statement with a snippet the per-site allow-list can match', () => {
    const hits = scanExecutionStatusWrites(`db.update(executions).set({ status: 'paused' }).where(x);`);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.snippet).toContain("status: 'paused'");
  });
});
