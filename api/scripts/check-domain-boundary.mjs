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
 * The 16 schema modules under `database/schema/` ARE that map now. They imported
 * each other 82 times when this guard landed, including cycles (`brain` ↔
 * `collaboration`, `work` ↔ `runtime`, `identity` ↔ `billing`). Step 2 merged the
 * modules onto the domains and every one of those cycles went with it: an import
 * between two files that became one file is not a boundary being crossed, it is a
 * boundary that stopped existing. **82 → 38.**
 *
 * WHY EDGES AND NOT A BAN. The two categories that are not violations are exempt
 * by rule rather than by baseline — a read of the kernel, and a foreign key to
 * `tenants`, which is tenancy. What is left is the real number. So the unit is
 * the EDGE
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
const SIBLING_IMPORT = /^\s*import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'\.\/([a-zA-Z0-9_]+)(?:\.js)?'/gm;

/**
 * Tenancy anchors. This guard's original note said it plainly: "a foreign key to
 * `tenants` is not a boundary violation, it is tenancy" — and that the edge would
 * stay counted only until the kernel existed to route it through. The kernel
 * exists now, and it deliberately does NOT own tenancy: `tenants` and `segments`
 * carry the plan, the billing relationship and the segment tree, which is
 * Identity's bounded context and not a primitive fifteen domains share.
 *
 * So the reference is exempt rather than moved. An import that brings in ONLY
 * these is a scoping reference; an import that brings in anything else alongside
 * them is a real read into Identity's tables and is still counted.
 */
const TENANCY_ANCHORS = new Set(['tenants', 'segments']);

/**
 * The kernel is the sanctioned route, so an edge INTO it is not a violation —
 * it is the rule being followed. PRD 20 §3: "cross-domain reads go through the
 * kernel or a named view, never a direct join into another domain's tables."
 * A domain referencing `objects`, `work_items` or `ledger_entries` is doing
 * exactly what the kernel exists for.
 *
 * The exemption is one-directional and that direction matters: `kernel.ts ->
 * anything` IS counted, and is the edge that would matter most, because the
 * moment the kernel depends on a domain the fifteen modules stop being
 * independently reviewable in the one place it is fatal (§6.2, interface
 * segregation). The kernel currently imports nothing, by construction.
 */
const KERNEL_MODULE = 'kernel.ts';

const findings = [];
for (const file of files.sort()) {
  const text = readFileSync(resolve(schemaDir, file), 'utf8');
  const real = new Set();
  for (const m of text.matchAll(SIBLING_IMPORT)) {
    const to = `${m[2]}.ts`;
    if (to === file || to === KERNEL_MODULE) continue;
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (names.length && names.every((n) => TENANCY_ANCHORS.has(n))) continue;
    real.add(m[2]);
  }
  for (const mod of [...real].sort()) {
    findings.push({ key: `${file} -> ${mod}.ts`, detail: `${file} reads ${mod}.ts directly; a cross-domain read belongs in the kernel or a named view.` });
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
