#!/usr/bin/env node
/**
 * Duplicate-shape guard (PRD 20 §4) — no two tables may be the same table twice.
 *
 * THE PROBLEM THIS EXISTS FOR. Exact name collisions across the three products
 * being consolidated number only 79 out of 1,206 tables, so name matching finds
 * almost none of the real duplication. Comparing tables by their COLUMN SIGNATURE
 * instead finds 35 duplicate clusters — and 23 of those sit inside a single
 * codebase, meaning they would exist even with no merge at all. This repo has 8
 * of them right now: `drive_connections` = `mailbox_connections`,
 * `portfolios` = `initiatives`, `tenant_custom_roles` = `platform_modules`, and
 * five more. Three are already slated to merge under PRD 20, which is the whole
 * argument: this guard would have stopped them being written.
 *
 * HOW IT WORKS
 *
 *   1. Payload columns only — `id`, `tenant_id`, `created_at` and friends are on
 *      every table and would make everything look alike.
 *   2. IDF weighting. `name` and `status` appear on hundreds of tables and carry
 *      almost no signal; `break_even_customers` appears on one and carries a lot.
 *      Weighting by inverse document frequency is what makes the comparison
 *      discriminating rather than a popularity contest.
 *   3. Weighted Jaccard ≥ 0.55 → the same shape. The threshold was calibrated on
 *      the 1,206-table corpus: at 0.55 the pairs it returns are, on inspection,
 *      genuinely the same table written twice; below it they start being merely
 *      similar (`marketing_leads` ~ `sales_leads` scores 0.31 and is a real merge,
 *      but so is `job_applications` ~ `queue_job_to_resume`, which is not).
 *   4. Union-find into clusters, so a three-way duplicate reports once.
 *
 * WHAT IT CANNOT SEE, stated because a clean run is not proof of a clean schema:
 * it finds tables that LOOK alike, and is blind to tables that MEAN alike.
 * `boards` and `kanban_boards` are the same concept and share not one payload
 * column. No threshold catches that; a person who knows the domain does.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDrizzleTables } from './lib/drizzleSchema.mjs';
import { reportRatchet, BOILERPLATE } from './lib/ratchet.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const srcDir = resolve(here, '..', 'src');

/** Above this, two tables are the same shape. See the calibration note above. */
const THRESHOLD = 0.55;
/** Below three payload columns there is nothing to compare — every join table
 *  would match every other join table and the guard would be noise. */
const MIN_PAYLOAD = 3;

const tables = parseDrizzleTables(srcDir);
if (tables.size === 0) {
  console.error('❌  Parsed zero tables. The schema moved or the parser broke — failing rather than passing vacuously.');
  process.exit(1);
}

const payload = new Map();
for (const [name, cols] of tables) {
  payload.set(name, new Set([...cols.keys()].filter((c) => !BOILERPLATE.has(c))));
}

const df = new Map();
for (const cols of payload.values()) for (const c of cols) df.set(c, (df.get(c) ?? 0) + 1);
const N = payload.size;
const idf = (c) => Math.log(N / (1 + (df.get(c) ?? 0)));

function similarity(a, b) {
  const A = payload.get(a);
  const B = payload.get(b);
  if (A.size < MIN_PAYLOAD || B.size < MIN_PAYLOAD) return 0;
  let inter = 0;
  let union = 0;
  for (const c of new Set([...A, ...B])) {
    const w = idf(c);
    union += w;
    if (A.has(c) && B.has(c)) inter += w;
  }
  return union ? inter / union : 0;
}

const names = [...payload.keys()];
const pairs = [];
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const s = similarity(names[i], names[j]);
    if (s >= THRESHOLD) pairs.push({ a: names[i], b: names[j], s });
  }
}

// Union-find, so a three-way duplicate is one finding rather than three pairs.
const parent = new Map();
const find = (x) => {
  if (!parent.has(x)) parent.set(x, x);
  if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
  return parent.get(x);
};
for (const { a, b } of pairs) {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent.set(ra, rb);
}
const clusters = new Map();
for (const { a, b } of pairs) {
  for (const n of [a, b]) {
    const r = find(n);
    if (!clusters.has(r)) clusters.set(r, new Set());
    clusters.get(r).add(n);
  }
}

const findings = [...clusters.values()].map((set) => {
  const members = [...set].sort();
  const worst = pairs
    .filter((p) => set.has(p.a) && set.has(p.b))
    .reduce((m, p) => Math.max(m, p.s), 0);
  return {
    // The key is the member list, so renaming a table shows up as a new finding
    // rather than silently inheriting the old one's amnesty.
    key: members.join(' = '),
    detail: `weighted column overlap ${worst.toFixed(2)} — one of these is the other one. Pick the survivor, add a kind column if the difference is real.`,
  };
});

reportRatchet({
  name: 'check-signature-duplication',
  baselinePath: resolve(here, '.signature-duplication-baseline.txt'),
  findings,
  unit: 'duplicate-shape cluster(s)',
  header: `Tables whose payload columns match at >= ${THRESHOLD} IDF-weighted Jaccard (PRD 20 §4).`,
  fixHint:
    'A new table duplicates the shape of one that already exists. Either use the existing\n' +
    '    table with a kind column, or fold both into a kernel primitive (PRD 20 §2).',
  update: process.argv.includes('--update'),
});
