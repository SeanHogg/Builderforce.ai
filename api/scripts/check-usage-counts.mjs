#!/usr/bin/env node
/**
 * Usage-count guard — "how many LLM calls" may never be spelled `COUNT(*)`.
 *
 * WHY THIS EXISTS. `llm_usage_log` is folded in place past
 * `LLM_USAGE_ROLLUP_AFTER_DAYS`: a day of calls becomes one row per dimension set, with
 * every summed quantity summed into it and the number of calls kept in `calls`. Every
 * figure any reader aggregates therefore survives the fold — except the ROW COUNT, which
 * is exactly what "requests" used to be. A `COUNT(*)` over this relation is not slightly
 * off after a fold, it is arbitrarily low, and it fails silently: no type error, no
 * exception, just a usage panel quietly reporting a fraction of the truth.
 *
 * So the correct spelling lives in ONE place — `usageRequestCount()` for a Drizzle
 * select and `usageRequestCountSql()` for a hand-written statement, both in
 * `application/llm/usageLedger.ts` — and this fails the build on any other.
 *
 * DELIBERATE ROW COUNTS ARE STILL LEGITIMATE, and there is one: the total behind a
 * paginated ROW LISTING, which has to count rows the way LIMIT/OFFSET walks them. Mark
 * such a query with a `usage-count-ok` comment anywhere inside it, saying why rows are
 * the right unit there.
 *
 * Run via `npm run check:usage-counts` and wired into `npm test`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');

/** Where the approved spellings are defined — exempt, it is the definition. */
const LEDGER = 'application/llm/usageLedger.ts';

const COUNT_STAR = /count\s*\(\s*\*\s*\)/i;
const ALLOW = /usage-count-ok/;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
  }
})(srcDir);

const failures = [];

/**
 * Every `sql` template literal in a file, with the line its counting text sits on.
 * Nesting is not a concern: these are flat tagged templates, and an inner `${...}`
 * expression that itself contains a backtick would only ever end the literal EARLY,
 * which splits one query into two fragments — both still scanned.
 */
function rawStatements(text) {
  const out = [];
  const re = /sql`([^`]*)`/gs;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ body: m[1], start: m.index });
  }
  return out;
}

/**
 * Every Drizzle `.select({ … }).from(llmUsageLog)` projection. Found from the `.from`
 * backwards, because the projection is what carries the count and the table is what
 * says the count is over this relation.
 */
function drizzleProjections(text) {
  const out = [];
  const re = /\.from\(\s*llmUsageLog\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const openSelect = text.lastIndexOf('.select(', m.index);
    if (openSelect === -1) continue;
    out.push({ body: text.slice(openSelect, m.index), start: openSelect });
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

for (const file of files) {
  const rel = relative(resolve(here, '..'), file).replace(/\\/g, '/');
  if (rel.endsWith(LEDGER)) continue;
  const text = readFileSync(file, 'utf8');
  if (!text.includes('llm_usage_log') && !text.includes('llmUsageLog')) continue;

  const candidates = [
    ...rawStatements(text).filter((s) => /\bllm_usage_log\b/.test(s.body)),
    ...drizzleProjections(text),
  ];

  for (const candidate of candidates) {
    // Strip `COUNT(DISTINCT x)` first — a distinct-value count is a different question
    // and the fold preserves it (the dimensions it counts are all kept).
    const scrubbed = candidate.body.replace(/count\s*\(\s*distinct[^)]*\)/gi, '');
    const hit = scrubbed.search(COUNT_STAR);
    if (hit === -1) continue;
    // Locate the offending text in the ORIGINAL body so the reported line is the real one.
    const realHit = candidate.body.search(COUNT_STAR);
    const absolute = candidate.start + (realHit === -1 ? 0 : realHit);
    // The marker may sit anywhere in the SAME query — a deliberate row count deserves a
    // sentence or two of justification, and pinning the note to the line above would make
    // the guard reject the explanation for being too long.
    if (ALLOW.test(candidate.body)) continue;
    failures.push(
      `${rel}:${lineOf(text, absolute)} counts llm_usage_log rows with COUNT(*). `
      + 'A folded row stands for many calls, so this under-reports by an arbitrary factor. '
      + 'Use usageRequestCount() (Drizzle) or usageRequestCountSql() (raw SQL) from '
      + 'application/llm/usageLedger.ts — or add a `usage-count-ok` comment saying why rows, '
      + 'not calls, are the right unit here.',
    );
  }
}

if (failures.length > 0) {
  console.error('❌ check:usage-counts');
  for (const failure of failures) console.error(`   • ${failure}`);
  process.exit(1);
}
console.log(`✅ check:usage-counts — ${files.length} files scanned, every llm_usage_log request count goes through the shared primitive.`);
