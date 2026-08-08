#!/usr/bin/env node
/**
 * Domain-boundary guard (PRD 20 §3) — one table, one domain.
 *
 * The target model is a 25-table kernel plus 362 tables across 15 domains, each
 * owned by exactly one seat on the roster: the CFO owns finance, the Recruiter
 * owns hiring, the Manager owns delivery. That ownership is only real if a domain
 * can be reviewed on its own, which means cross-domain reads go through the kernel
 * or a named view — never a direct import of another domain's tables.
 *
 * The 16 schema modules under `database/schema/` are already most of that map, and
 * they currently import each other 82 times, including cycles (`brain` ↔
 * `collaboration`, `work` ↔ `runtime`, `identity` ↔ `billing`). Every one of those
 * edges is a reason two domains cannot be reasoned about separately.
 *
 * WHY EDGES AND NOT A BAN. Some of the 82 are legitimate today and will stay so
 * until the kernel exists to route them through — a foreign key to `tenants` is
 * not a boundary violation, it is tenancy. So the unit is the EDGE
 * (`from.ts -> to.ts`), baselined, shrinking as PRD 20 §5 step 2 merges modules
 * into domains. A new edge between two modules that did not previously touch is
 * the thing worth failing on, because that is a boundary being crossed for the
 * first time and it is cheapest to argue about then.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportRatchet } from './lib/ratchet.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const schemaDir = resolve(here, '..', 'src', 'infrastructure', 'database', 'schema');

const files = readdirSync(schemaDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
if (files.length === 0) {
  console.error(`❌  No schema modules found under ${schemaDir}. Failing rather than passing vacuously.`);
  process.exit(1);
}

/** `import … from './identity'` / `'./identity.js'` — sibling modules only. A
 *  deeper path is not a domain edge, it is a layering question `check-layering.mjs`
 *  already owns. */
const SIBLING_IMPORT = /^\s*import\s+[\s\S]*?from\s+'\.\/([a-zA-Z0-9_]+)(?:\.js)?'/gm;

const findings = [];
for (const file of files.sort()) {
  const text = readFileSync(resolve(schemaDir, file), 'utf8');
  const seen = new Set();
  for (const m of text.matchAll(SIBLING_IMPORT)) {
    const to = `${m[1]}.ts`;
    if (to === file || seen.has(to)) continue;
    seen.add(to);
    findings.push({ key: `${file} -> ${m[1]}.ts`, detail: `${file} reads ${m[1]}.ts directly; a cross-domain read belongs in the kernel or a named view.` });
  }
}

reportRatchet({
  name: 'check-domain-boundary',
  baselinePath: resolve(here, '.domain-boundary-baseline.txt'),
  findings,
  unit: 'cross-module schema import(s)',
  header: 'Direct imports between schema modules (PRD 20 §3). Shrinks as modules merge into domains; a NEW edge is a boundary crossed for the first time.',
  fixHint:
    'Two schema modules that did not previously reference each other now do. Route the\n' +
    '    reference through the kernel or a named view, or say why these are one domain.',
  update: process.argv.includes('--update'),
});
