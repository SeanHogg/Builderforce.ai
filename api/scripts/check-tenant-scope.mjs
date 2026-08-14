#!/usr/bin/env node
/**
 * Tenant-scope ratchet — a query against a tenant-owned table must filter by tenant.
 *
 * 306 of the 374 tables carry `tenant_id`, and the rule "every query against them
 * is scoped to the caller's tenant" is what keeps customers' data apart. It is
 * currently re-typed by hand at ~1,100 sites. An omission does not fail to
 * compile and does not throw — it just returns another tenant's rows. This guard
 * turns that from a review-by-eye invariant into a mechanical one.
 *
 * HOW IT WORKS
 *
 *   1. Parse `schema.ts` for every `pgTable` whose column block declares
 *      `tenantId:` — that is the set of tenant-owned tables.
 *   2. Walk each source file for Drizzle statement heads (`db.select(`,
 *      `db.update(`, `db.delete(`, `tx.select(`, …) and extract the WHOLE chained
 *      statement by balancing brackets to its terminator. No line windows: the
 *      unit examined is exactly the statement.
 *   3. If a statement targets a tenant-owned table (`.from(t)`, `.update(t)`,
 *      `.delete(t)`) and its text mentions neither `scopedToTenant` /
 *      `scopedToSegment` nor any `tenantId` / `tenant_id` reference, it is a
 *      violation.
 *
 * Like the layering guard, this is a RATCHET, not a wall: the ~N statements that
 * violate it today are recorded per-file in `scripts/.tenant-scope-baseline.txt`
 * as `path:count`. A file may not gain violations, and a file that has been
 * cleaned must have its baseline line lowered. The debt is frozen and pays down
 * monotonically.
 *
 * KNOWN LIMITS (deliberate — this is a build guard, not a prover):
 *   - `db.insert(t)` is not checked: an insert supplies tenantId as a VALUE, not
 *     a predicate, and its correctness ("is this the CALLER's tenant?") is not
 *     decidable from syntax.
 *   - A statement that mentions `tenantId` anywhere counts as scoped, so a query
 *     that selects the column without filtering on it passes. That is the price
 *     of a syntactic check; it still catches the query with no tenant reference
 *     at all, which is the failure mode that leaks data.
 *
 * Run via `npm run check:tenant-scope`; wired into `npm test`.
 * `--update` rewrites the baseline (use when paying debt down in bulk).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');
const schemaDir = resolve(srcDir, 'infrastructure/database/schema');
const baselineFile = resolve(here, '.tenant-scope-baseline.txt');

const UPDATE = process.argv.includes('--update');

// ---------------------------------------------------------------------------
// 1 · Which tables are tenant-owned?
// ---------------------------------------------------------------------------

/** `export const foo = pgTable('foo', {` … up to the matching close. */
function tenantOwnedTables(schemaText) {
  const owned = new Set();
  const decl = /export const (\w+)\s*=\s*pgTable\(/g;
  let m;
  while ((m = decl.exec(schemaText)) !== null) {
    const varName = m[1];
    // Walk forward from the opening paren, balancing brackets, to find the end
    // of the pgTable(...) call — that span is the table's definition.
    let i = schemaText.indexOf('(', m.index + m[0].length - 1);
    let depth = 0;
    let end = i;
    for (; end < schemaText.length; end++) {
      const ch = schemaText[end];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = schemaText.slice(i, end);
    if (/\btenantId\s*:/.test(body)) owned.add(varName);
  }
  return owned;
}

/**
 * Read every schema source. The definitions live in `database/schema/*.ts` (one
 * file per bounded context) with `database/schema.ts` as the barrel — reading
 * only the barrel would find ZERO tables and the guard would pass vacuously,
 * which is exactly how a security check rots into decoration. Anything under
 * `src/` that declares a `pgTable` counts, so a table declared outside the schema
 * directory is covered too.
 */
function allSchemaSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(full);
    }
  };
  walk(srcDir);
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

const TENANT_TABLES = tenantOwnedTables(allSchemaSources());

if (TENANT_TABLES.size === 0) {
  console.error(
    '❌  Found no tenant-owned tables at all. The schema moved or the parser broke —\n' +
      '    either way this guard would pass vacuously, so it fails instead.\n' +
      `    Expected pgTable declarations with a tenantId column under ${relative(srcDir, schemaDir)}/.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2 · Extract whole Drizzle statements
// ---------------------------------------------------------------------------

/**
 * Blank out COMMENTS, preserving every character position.
 *
 * The scanner below is a bracket counter, and prose is full of the characters it
 * counts. A comma inside a `//` comment mid-chain — `// LEFT join: a mailbox
 * campaign has no sender identity at all, and an inner join …` — terminated the
 * statement BEFORE its `.where()`, so a properly scoped query was reported as
 * unscoped. A `)` in prose does the same thing in the other direction: it can
 * end the statement early and MASK a real violation.
 *
 * Strings are skipped over but NOT blanked: a raw `sql\`… tenant_id = …\`` is a
 * genuine tenant predicate, and blanking it would turn a scoped query into a
 * reported violation. Skipping is still necessary so that a `//` inside a string
 * (`'https://…'`) is not mistaken for the start of a comment.
 *
 * Positions are preserved (comment bodies become spaces, newlines kept) so
 * reported line numbers still point at the real source.
 */
function blankComments(text) {
  const out = text.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === '\\') { j++; continue; }
        if (text[j] === ch) break;
        // An unterminated quote is an apostrophe in prose we mis-read, not a
        // string — stop at the newline rather than skip the rest of the file.
        if (text[j] === '\n' && ch !== '`') break;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** A statement head: `db.select(`, `this.db.update(`, `tx.delete(`, … */
const STATEMENT_HEAD = /\b(?:db|tx|trx|this\.db)\s*\.\s*(select|selectDistinct|update|delete)\s*\(/g;

/**
 * From `start` (index of the head), return the full chained statement text.
 * Terminates on `;`, or on a closing bracket that unbalances past the start
 * depth, or on a `,`/newline at depth 0 that cannot continue a chain.
 */
function extractStatement(text, start) {
  let depth = 0;
  let i = start;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth < 0) break; // ran past the enclosing expression
    } else if (ch === ';' && depth === 0) break;
    else if (ch === ',' && depth === 0) break;
  }
  return text.slice(start, i);
}

/**
 * The DRIVING table(s) of a statement — what it selects from, updates or deletes.
 *
 * Joined tables are deliberately NOT counted: when the driving table is
 * tenant-scoped, a join reached through its foreign key is constrained by that
 * scope already, so flagging the join would be noise rather than signal.
 */
function targetTables(statement) {
  const targets = new Set();
  const re = /\.\s*(?:from|update|delete)\s*\(\s*(\w+)/g;
  let m;
  while ((m = re.exec(statement)) !== null) targets.add(m[1]);
  return targets;
}

/**
 * What counts as "this statement has thought about tenancy".
 *
 * `acrossTenants` is the DECLARED exception: a read with no tenant to filter by —
 * the public marketplace catalogue, a share token, a superadmin surface — which
 * says so in the statement and must still supply an access predicate of its own
 * (see infrastructure/database/tenantScope.ts). It is admitted here rather than
 * through the baseline on purpose: the baseline is frozen DEBT and may only
 * shrink, and filing a deliberate decision there would make the number go up when
 * nothing is owed, then dare the next person to pay it down by breaking a feature.
 */
const SCOPED = /scopedToTenant|scopedToSegment|acrossTenants|tenantId|tenant_id/;

/**
 * Conditions are very often accumulated into a local array and spread into the
 * `where` (`.where(and(...conds))`), which puts the tenant predicate OUTSIDE the
 * statement text. Collect those spread identifiers so the caller can widen the
 * search to where the array is built.
 */
function spreadIdentifiers(statement) {
  const ids = new Set();
  const re = /\.\s*where\s*\([^)]*?\.\.\.\s*(\w+)/gs;
  let m;
  while ((m = re.exec(statement)) !== null) ids.add(m[1]);
  // Also catch `and(...conds)` nested a level deeper than the naive [^)]* above.
  const re2 = /\.\.\.\s*(\w+)\s*\)/g;
  while ((m = re2.exec(statement)) !== null) ids.add(m[1]);
  return ids;
}

/**
 * Does `ident` ever receive a tenant predicate in this file? Matches the two ways
 * a conditions array gets built: an initialiser (`const conds = [eq(t.tenantId, …)]`)
 * and a push (`conds.push(eq(t.tenantId, …))`).
 */
function arrayCarriesTenant(text, ident) {
  const init = new RegExp(`(?:const|let|var)\\s+${ident}\\b[^;]*tenantId`, 's');
  const push = new RegExp(`\\b${ident}\\s*\\.\\s*push\\s*\\([^;]*tenantId`, 's');
  return init.test(text) || push.test(text);
}

function violationsIn(source) {
  const text = blankComments(source);
  const found = [];
  STATEMENT_HEAD.lastIndex = 0;
  let m;
  while ((m = STATEMENT_HEAD.exec(text)) !== null) {
    const statement = extractStatement(text, m.index);
    const targets = [...targetTables(statement)].filter((t) => TENANT_TABLES.has(t));
    if (targets.length === 0) continue;
    if (SCOPED.test(statement)) continue;
    // The predicate may live in a conditions array built just above the query.
    const spreads = [...spreadIdentifiers(statement)];
    if (spreads.some((id) => arrayCarriesTenant(text, id))) continue;
    const line = text.slice(0, m.index).split('\n').length;
    found.push({ line, tables: targets });
  }
  return found;
}

// ---------------------------------------------------------------------------
// 3 · Walk the tree and ratchet
// ---------------------------------------------------------------------------

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** path -> violation count */
const current = new Map();
/** path -> [{line, tables}] for reporting */
const details = new Map();

for (const file of collect(srcDir)) {
  // Tests build fixtures against fixed ids and are not the shipped call graph.
  if (file.endsWith('.test.ts')) continue;
  const rel = relative(srcDir, file).split('\\').join('/');
  if (rel === 'infrastructure/database/schema.ts' || rel.startsWith('infrastructure/database/schema/')) continue;
  const found = violationsIn(readFileSync(file, 'utf8'));
  if (found.length > 0) {
    current.set(rel, found.length);
    details.set(rel, found);
  }
}

if (UPDATE) {
  const header =
    '# Unscoped Drizzle statements against tenant-owned tables, as path:count.\n' +
    '# Counts may only go DOWN — see scripts/check-tenant-scope.mjs.\n' +
    '# Regenerate with: node scripts/check-tenant-scope.mjs --update\n';
  const body = [...current.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, count]) => `${path}:${count}`)
    .join('\n');
  writeFileSync(baselineFile, header + body + '\n', 'utf8');
  const total = [...current.values()].reduce((a, b) => a + b, 0);
  console.log(`Baseline rewritten: ${current.size} file(s), ${total} statement(s).`);
  process.exit(0);
}

const baseline = new Map();
if (existsSync(baselineFile)) {
  for (const raw of readFileSync(baselineFile, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.lastIndexOf(':');
    baseline.set(line.slice(0, idx), Number(line.slice(idx + 1)));
  }
}

const regressions = [];
const improvements = [];

for (const [path, count] of current) {
  const allowed = baseline.get(path) ?? 0;
  if (count > allowed) regressions.push({ path, count, allowed });
}
for (const [path, allowed] of baseline) {
  const count = current.get(path) ?? 0;
  if (count < allowed) improvements.push({ path, count, allowed });
}

let failed = false;

if (regressions.length > 0) {
  failed = true;
  console.error(`❌  Unscoped tenant queries added (${regressions.length} file(s)):\n`);
  for (const { path, count, allowed } of regressions) {
    console.error(`   ${path}  ${allowed} → ${count}`);
    for (const { line, tables } of details.get(path) ?? []) {
      console.error(`      line ${line}: ${tables.join(', ')}`);
    }
  }
  console.error(
    '\n   Every query against a tenant-owned table must filter by tenant. Use the' +
      '\n   primitive rather than retyping the predicate:' +
      '\n' +
      '\n      import { scopedToTenant } from \'…/infrastructure/database/tenantScope\';' +
      '\n      .where(scopedToTenant(tasks, tenantId, eq(tasks.id, id)))' +
      '\n' +
      '\n   (Use scopedToSegment for the segmented tier.) The baseline in' +
      '\n   scripts/.tenant-scope-baseline.txt is frozen debt — it may only shrink.\n',
  );
}

if (improvements.length > 0) {
  failed = true;
  console.error(`✅→❌  ${improvements.length} file(s) improved — lower their baseline so the ratchet holds:\n`);
  for (const { path, count, allowed } of improvements) {
    console.error(`   ${path}  ${allowed} → ${count}${count === 0 ? '  (remove the line)' : ''}`);
  }
  console.error('\n   Run: node scripts/check-tenant-scope.mjs --update\n');
}

if (failed) process.exit(1);

const total = [...current.values()].reduce((a, b) => a + b, 0);
console.log(
  `✅  Tenant-scope ratchet OK — ${TENANT_TABLES.size} tenant-owned tables; ` +
    `${total} known unscoped statement(s) across ${current.size} file(s); 0 new.`,
);
