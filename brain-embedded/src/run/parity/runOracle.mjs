#!/usr/bin/env node
/**
 * Run the parity oracle (PRD 35 WS4, D3): the test files that drive `startRun`, listed in `oracle.files.txt`, UNCHANGED,
 * on one engine. `BRAIN_RUN_ENGINE` selects it (`runStore/runEngine.ts`), so the same assertions prove both.
 *
 *   node brain-embedded/src/run/parity/runOracle.mjs <package> <loop|agent>
 *
 * <package> is `brain-embedded`, `clients/chrome` or `clients/vscode`: the files under it run through that package's own
 * vitest config. The list is guarded by `oracle.test.ts`, so a new test that drives `startRun` cannot miss it.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [pkg, engine] = process.argv.slice(2);
if (!pkg || (engine !== 'loop' && engine !== 'agent')) {
  console.error('usage: runOracle.mjs <brain-embedded|clients/chrome|clients/vscode> <loop|agent>');
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const files = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'oracle.files.txt'), 'utf8')
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.startsWith(`${pkg}/`))
  .map((l) => l.slice(pkg.length + 1));
if (files.length === 0) {
  console.error(`no oracle files under ${pkg}`);
  process.exit(2);
}
console.log(`oracle: ${files.length} file(s) in ${pkg} on the ${engine} engine`);
const run = spawnSync('pnpm', ['exec', 'vitest', 'run', ...files], {
  cwd: join(root, pkg),
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, BRAIN_RUN_ENGINE: engine },
});
process.exit(run.status ?? 1);
