/**
 * Silent-catch guard — repo-wide, with a per-package ratchet.
 *
 * An error that reaches a `catch` and stops there is invisible: no durable record,
 * no Product Quality group, nothing to answer "why did this fail" with. `api/src`
 * has held zero of them for a while; the other packages never had the guard at all
 * and had accumulated hundreds between them.
 *
 * Bringing them to zero is not one pass — many of the counted sites are legitimate
 * `JSON.parse` fallbacks, and the rest need a reporter their package does not have
 * yet. So each target carries a BASELINE count instead: the guard fails when a
 * count rises, and equally when it falls without the baseline being lowered. The
 * number can only go down, and every step down is a recorded diff.
 *
 *   node scripts/check-silent-catches.mjs                       # CI / `npm test`
 *   node scripts/check-silent-catches.mjs --target frontend/src # one tree only
 *   node scripts/check-silent-catches.mjs --update-baseline     # after fixing sites
 *
 * `--update-baseline` refuses to RAISE a count. Adding a silent catch is a code
 * change to argue about in review, never a baseline edit.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSourceFiles, loadTypeScript, toPosix } from './lib/moduleImports.mjs';
import { findSilentCatches, RULES, RULE_DESCRIPTIONS } from './lib/silentCatchRules.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(repoRoot, 'scripts', 'silent-catches.baseline.json');

/** The source trees the guard covers. Adding a package is one line. */
const ALL_TARGETS = ['api/src', 'frontend/src', 'agent-runtime/src', 'worker/src'];

/**
 * `--target <tree>` (repeatable) narrows the sweep so a package's own `npm test`
 * pays only for its own tree. Baseline entries for trees that were not scanned are
 * left exactly as they are.
 */
function selectedTargets(argv) {
  const requested = argv.flatMap((arg, index) => (arg === '--target' ? [argv[index + 1]] : []));
  if (requested.length === 0) return ALL_TARGETS;
  const unknown = requested.filter((target) => !ALL_TARGETS.includes(target));
  if (unknown.length > 0) {
    console.error(`Unknown --target: ${unknown.join(', ')}. Known targets: ${ALL_TARGETS.join(', ')}.`);
    process.exit(1);
  }
  return requested;
}

const TARGETS = selectedTargets(process.argv.slice(2));

/**
 * Files a rule cannot apply to, by construction.
 * `caughtErrorReporter.ts` IS the durable sink: its terminal fallback has nowhere
 * left to report to, so its console line is the contract rather than a bypass.
 */
const EXEMPTIONS = {
  'console-only': ['api/src/application/observability/caughtErrorReporter.ts'],
};

const isExempt = (rule, relativePath) => EXEMPTIONS[rule]?.includes(relativePath) === true;

const isCheckedSource = (path) => /\.tsx?$/.test(path)
  && !/\.d\.ts$/.test(path)
  && !/\.(test|spec)\.tsx?$/.test(path);

const ts = loadTypeScript(repoRoot);

/** @type {Record<string, Record<string, number>>} */
const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : {};

const updating = process.argv.includes('--update-baseline');

/** @type {Record<string, Record<string, number>>} */
const counts = {};
/** @type {Record<string, import('./lib/silentCatchRules.mjs').Violation[]>} */
const found = {};
let scanned = 0;

for (const target of TARGETS) {
  const absolute = join(repoRoot, ...target.split('/'));
  if (!existsSync(absolute)) {
    console.error(`Silent catch check failed — target '${target}' does not exist.`);
    process.exit(1);
  }

  const violations = [];
  for (const filePath of collectSourceFiles(absolute).filter(isCheckedSource)) {
    scanned += 1;
    const relativePath = toPosix(relative(repoRoot, filePath));
    const sourceFile = ts.createSourceFile(
      filePath,
      readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    violations.push(...findSilentCatches(ts, sourceFile, relativePath, isExempt));
  }

  found[target] = violations;
  counts[target] = Object.fromEntries(
    RULES.map((rule) => [rule, violations.filter((v) => v.rule === rule).length]),
  );
}

if (updating) {
  const raised = [];
  for (const target of TARGETS) {
    for (const rule of RULES) {
      // A target with no entry yet is being SEEDED — that is the one time a number
      // may go up. Once recorded it is a ratchet, and only ever falls.
      const allowed = baseline[target]?.[rule];
      if (allowed !== undefined && counts[target][rule] > allowed) {
        raised.push(`${target} ${rule}: ${allowed} → ${counts[target][rule]}`);
      }
    }
  }
  if (raised.length > 0) {
    console.error('Refusing to raise the silent-catch baseline — fix the new sites instead:');
    for (const entry of raised) console.error(`  ${entry}`);
    process.exit(1);
  }
  const merged = Object.fromEntries(
    ALL_TARGETS.filter((target) => counts[target] ?? baseline[target])
      .map((target) => [target, counts[target] ?? baseline[target]]),
  );
  writeFileSync(baselinePath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`Silent catch baseline updated from ${scanned} files.`);
  process.exit(0);
}

const regressions = [];
const slack = [];
for (const target of TARGETS) {
  for (const rule of RULES) {
    const allowed = baseline[target]?.[rule] ?? 0;
    const actual = counts[target][rule];
    if (actual > allowed) regressions.push({ target, rule, allowed, actual });
    else if (actual < allowed) slack.push(`${target} ${rule}: ${allowed} → ${actual}`);
  }
}

if (regressions.length > 0) {
  console.error(`Silent catch check failed — ${regressions.length} rule(s) above baseline:`);
  for (const { target, rule, allowed, actual } of regressions) {
    console.error(`\n  ${target} · ${rule}: ${actual} (baseline ${allowed})`);
    console.error(`  ${RULE_DESCRIPTIONS[rule]}`);
    for (const violation of found[target].filter((v) => v.rule === rule)) {
      console.error(`    ${violation.file}:${violation.line}`);
    }
  }
  process.exit(1);
}

if (slack.length > 0) {
  console.error('Silent catch check failed — the baseline has slack. Run `node scripts/check-silent-catches.mjs --update-baseline` to lock in:');
  for (const entry of slack) console.error(`  ${entry}`);
  process.exit(1);
}

const total = TARGETS.reduce(
  (sum, target) => sum + RULES.reduce((inner, rule) => inner + counts[target][rule], 0),
  0,
);
console.log(`Silent catch check passed: ${scanned} source files across ${TARGETS.length} tree(s), ${total} site(s) at baseline.`);
