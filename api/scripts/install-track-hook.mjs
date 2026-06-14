#!/usr/bin/env node
/**
 * One-shot installer for the isolation-track pre-commit hook (T9 steward).
 * Points git at the tracked hooks dir so `check-track-scope.mjs --staged` runs
 * before every commit. Idempotent. Run from anywhere in the repo:
 *   node api/scripts/install-track-hook.mjs
 */
import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8' }).trim();
const hooksPath = 'api/scripts/git-hooks';

execFileSync('git', ['config', 'core.hooksPath', hooksPath], { cwd: repoRoot });
try {
  chmodSync(resolve(repoRoot, hooksPath, 'pre-commit'), 0o755);
} catch {
  /* chmod is a no-op / unsupported on Windows — git still runs the hook via sh */
}

console.log(`✅  Installed track-scope pre-commit hook (core.hooksPath = ${hooksPath}).`);
console.log('   Every commit on a track/<id> branch is now scope-checked. Bypass once with --no-verify.');
