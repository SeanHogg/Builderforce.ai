/**
 * check:one-execution — PRD 35 §3.3, report mode.
 *
 * The whole point of the one-agent-one-kernel split is that `runAgent`
 * (`packages/agent-run/src/runAgent.ts`) is the ONLY thing that drives
 * `runAgentLoop` (`@builderforce/agent-loop`). No other translation layer, no
 * per-surface loop, no second agent loop hiding in a package. This guard scans every
 * package's source for imports of `runAgentLoop` (or the loop's codec helpers that
 * only a second loop would need) and reports the current importers.
 *
 * REPORT MODE (WS1): it prints the importer list and the §7 ledger's "one execution
 * path" row. It does not fail the build yet — WS7 flips it to enforced mode once the
 * five loop-bearing files named in the ledger have been ported onto `runAgent` and
 * deleted. Until then this is the baseline the program works against.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { collectSourceFiles, toPosix } from './lib/moduleImports.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NEEDLE = 'runAgentLoop';

// The packages whose SOURCE may legitimately reference the kernel today. Test files and
// the kernel's own package are excluded from the "second loop" question — a test drives
// the loop directly, and the loop package defines it.
const PACKAGES = ['packages', 'brain-embedded/src', 'agent-runtime/src', 'api/src', 'clients/vscode/src', 'frontend/src'];

const importers = [];
for (const pkg of PACKAGES) {
  const dir = resolve(repoRoot, pkg);
  for (const file of collectSourceFiles(dir)) {
    const name = file.split(/[\\/]/).pop() ?? '';
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) continue;
    if (toPosix(file).includes('packages/agent-loop/')) continue;
    if (toPosix(file).includes('packages/agent-run/')) continue;
    const text = readFileSync(file, 'utf8');
    if (!text.includes(NEEDLE)) continue;
    const rel = toPosix(file).replace(toPosix(repoRoot) + '/', '');
    importers.push(rel);
  }
}

// The five loop-bearing files PRD 35 §3.3 names, at their real paths. WS7 flips this
// guard to enforced mode once all five are ported onto `runAgent` and deleted; until
// then this is the baseline the program works against.
const BASELINE = [
  'api/src/application/runtime/cloudAgentEngine.ts',
  'agent-runtime/src/builderforce/agent-loop/agent-loop.ts',
  'api/src/application/brain/agentReplyLoop.ts',
  'frontend/src/lib/creationCanvasAi.ts',
  'brain-embedded/src/runStore/runLoop.ts',
];

console.log('check:one-execution (report mode)');
console.log('  Current importers of runAgentLoop outside @builderforce/agent-loop:');
for (const imp of [...importers].sort()) console.log(`    - ${imp}`);

const extra = importers.filter((imp) => !BASELINE.includes(imp));
const missing = BASELINE.filter((b) => !importers.includes(b));
if (extra.length > 0) {
  console.log(`  NEW importers not in the WS1 baseline (${extra.length}):`);
  for (const imp of extra) console.log(`    + ${imp}`);
}
if (missing.length > 0) {
  console.log(`  Baseline importers no longer present (ported & deleted?) (${missing.length}):`);
  for (const imp of missing) console.log(`    - ${imp}`);
}
console.log('  §7 ledger "one execution path": runAgent (packages/agent-run/src/runAgent.ts)');
console.log('  Enforced in WS7 — this guard is report-only until the five loop-bearing files are ported.');
process.exit(0);
