#!/usr/bin/env node
/**
 * Runs a preset of the extension's build steps (`buildSteps.mjs`) in order, timing each:
 *
 *   node scripts/prepublish.mjs [prepublish|compile|webview]      (default: prepublish)
 *
 * Prints `[<preset>] <step> 12.3s` per step and a total, and stops at the first failing step
 * with that step's own exit code — what the `&&` chain it replaces did.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRESETS, STEPS } from './buildSteps.mjs';

const vscodeDir = fileURLToPath(new URL('..', import.meta.url));
const presetName = process.argv[2] ?? 'prepublish';
const preset = PRESETS[presetName];
if (!preset) {
  console.error(`[${presetName}] unknown preset "${presetName}"; expected one of: ${Object.keys(PRESETS).join(', ')}`);
  process.exit(2);
}

const seconds = (since) => `${((performance.now() - since) / 1000).toFixed(1)}s`;
const startedAll = performance.now();

for (const key of preset) {
  const step = STEPS[key];
  const started = performance.now();
  const result = spawnSync(step.command, step.args, { cwd: vscodeDir, stdio: 'inherit', shell: step.shell ?? false });
  console.log(`[${presetName}] ${step.name} ${seconds(started)}${result.status === 0 ? '' : ' (FAILED)'}`);
  if (result.status !== 0) {
    if (result.error) console.error(`[${presetName}] ${step.name}: ${result.error.message}`);
    console.log(`[${presetName}] total ${seconds(startedAll)}`);
    process.exit(result.status ?? 1);
  }
}
console.log(`[${presetName}] total ${seconds(startedAll)}`);
