/**
 * check:one-execution — PRD 35 §3.3, report mode.
 *
 * The whole point of the one-agent-one-kernel split is that `runAgent`
 * (`packages/agent-run/src/runAgent.ts`) is the ONLY thing that drives `runAgentLoop`
 * (`@builderforce/agent-loop`), and `packages/agent-run` the only place run policy is
 * composed. §3.3's done-check: nothing outside `packages/agent-run` imports
 * `runAgentLoop` or any `policy/*` module. This guard scans every project's source for
 * both and reports them against the WS1 baseline.
 *
 * It matches IMPORTS, not mentions: a comment or a string naming `runAgentLoop` is not a
 * second loop. Test files are excluded (a test drives the loop directly), as is the
 * kernel's own package. Inside `packages/agent-run` the rule is tighter still: only
 * `src/runAgent.ts` imports `runAgentLoop` — any other file there is a second driver.
 *
 * REPORT MODE (WS1): it prints the importers, what is new against the baseline and what
 * has left it, and exits 0. WS7 flips it to enforced mode (exit 1 on any importer) once
 * the five loop-bearing files are ported onto `runAgent` and deleted. Pass `--enforce`
 * to preview that verdict.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { collectSourceFiles, toPosix } from './lib/moduleImports.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENFORCE = process.argv.includes('--enforce');

// Every project whose source could host a second loop or reach into the agent's policy.
const ROOTS = ['packages', 'brain-embedded/src', 'agent-runtime/src', 'api/src', 'clients/vscode/src', 'clients/chrome/src', 'frontend/src'];
const OWN = ['packages/agent-loop/', 'packages/agent-run/'];
const AGENT_RUN = 'packages/agent-run/';
/** The ONE file inside the agent that drives the kernel. */
const THE_DRIVER = 'packages/agent-run/src/runAgent.ts';
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Every `import … from '…'` / `export … from '…'` statement, with its bindings and specifier. */
const IMPORT_STATEMENT = /(?:^|[\n;])\s*(?:import|export)\s+(?:type\s+)?([\w$*\s{},]+?)\s+from\s+['"]([^'"]+)['"]/g;
/** A dynamic `import('…')`. */
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** `runAgentLoop` among a statement's bindings (`{ runAgentLoop }`, `{ runAgentLoop as x }`, a namespace import of the kernel). */
function importsKernelLoop(bindings, specifier) {
  if (specifier !== '@builderforce/agent-loop' && !/packages\/agent-loop\//.test(specifier)) return false;
  return /\brunAgentLoop\b/.test(bindings) || /^\*\s+as\s+\w+$/.test(bindings.trim());
}

/** A specifier that reaches into the agent's policy modules from outside the package. */
function reachesPolicy(specifier) {
  return /^@builderforce\/agent-run\/.*\bpolicy\b/.test(specifier) || /(^|\/)agent-run\/src\/policy(\/|$)/.test(specifier);
}

/** @type {{ file: string; kind: 'kernel-loop' | 'inner-loop' | 'policy'; specifier: string }[]} */
const findings = [];
for (const root of ROOTS) {
  for (const file of collectSourceFiles(resolve(repoRoot, root))) {
    const rel = toPosix(file).replace(toPosix(repoRoot) + '/', '');
    if (TEST_FILE.test(rel)) continue;
    if (rel.startsWith(AGENT_RUN)) {
      // Inside the agent: policy imports are its own; only a second kernel driver counts.
      if (rel === THE_DRIVER) continue;
      const text = readFileSync(file, 'utf8');
      if (!text.includes('runAgentLoop')) continue;
      for (const [, bindings, specifier] of text.matchAll(IMPORT_STATEMENT)) {
        if (importsKernelLoop(bindings, specifier)) findings.push({ file: rel, kind: 'inner-loop', specifier });
      }
      continue;
    }
    if (OWN.some((own) => rel.startsWith(own))) continue;
    const text = readFileSync(file, 'utf8');
    if (!text.includes('runAgentLoop') && !text.includes('agent-run')) continue;
    for (const [, bindings, specifier] of text.matchAll(IMPORT_STATEMENT)) {
      if (importsKernelLoop(bindings, specifier)) findings.push({ file: rel, kind: 'kernel-loop', specifier });
      else if (reachesPolicy(specifier)) findings.push({ file: rel, kind: 'policy', specifier });
    }
    for (const [, specifier] of text.matchAll(DYNAMIC_IMPORT)) {
      if (reachesPolicy(specifier)) findings.push({ file: rel, kind: 'policy', specifier });
    }
  }
}

// The five loop-bearing files PRD 35 §3.3 names, at their real paths — today's kernel
// importers. Nothing imports a `policy/*` module from outside today, so that baseline is
// empty. WS7 empties this list and flips the guard to enforced.
const BASELINE = [
  'agent-runtime/src/builderforce/agent-loop/agent-loop.ts',
  'api/src/application/brain/agentReplyLoop.ts',
  'api/src/application/runtime/cloudAgentEngine.ts',
  'brain-embedded/src/runStore/runLoop.ts',
];

const loopImporters = [...new Set(findings.filter((f) => f.kind === 'kernel-loop').map((f) => f.file))].sort();
const policyImporters = findings.filter((f) => f.kind === 'policy');
const innerImporters = [...new Set(findings.filter((f) => f.kind === 'inner-loop').map((f) => f.file))].sort();
const extra = loopImporters.filter((file) => !BASELINE.includes(file));
const gone = BASELINE.filter((file) => !loopImporters.includes(file));

console.log(`check:one-execution (${ENFORCE ? 'enforce preview' : 'report mode'})`);
console.log(`  Importers of runAgentLoop outside @builderforce/agent-loop and @builderforce/agent-run (${loopImporters.length}):`);
for (const file of loopImporters) console.log(`    - ${file}${BASELINE.includes(file) ? '' : '   (NEW — not in the WS1 baseline)'}`);
if (policyImporters.length > 0) {
  console.log(`  Imports of agent-run policy/* from outside the package (${policyImporters.length}) — never allowed:`);
  for (const f of policyImporters) console.log(`    + ${f.file} → ${f.specifier}`);
}
if (innerImporters.length > 0) {
  console.log(`  Importers of runAgentLoop inside packages/agent-run other than ${THE_DRIVER} (${innerImporters.length}) — never allowed:`);
  for (const file of innerImporters) console.log(`    + ${file}`);
}
if (gone.length > 0) {
  console.log(`  Baseline importers no longer present (ported & deleted — drop them from BASELINE) (${gone.length}):`);
  for (const file of gone) console.log(`    - ${file}`);
}
console.log('  §3.3: the one execution path is runAgent (packages/agent-run/src/runAgent.ts).');

const violations = ENFORCE ? loopImporters.length + policyImporters.length + innerImporters.length : 0;
if (violations > 0) {
  console.log(`  ✗ ${violations} import(s) outside the one agent.`);
  process.exit(1);
}
if (!ENFORCE) console.log(`  Report only (${extra.length} new, ${policyImporters.length} policy reach-in, ${innerImporters.length} second driver in agent-run) — WS7 enforces.`);
process.exit(0);
