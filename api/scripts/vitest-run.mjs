#!/usr/bin/env node
/**
 * `pnpm test -- <file>` forwards the `--` separator. Vitest treats that `--`
 * as an option and drops the filename, so the suite runs unfiltered. Strip one
 * leading `--`, then exec `vitest run` with whatever remains.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();

const vitest = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(process.execPath, [vitest, 'run', ...args], { stdio: 'inherit' });
process.exit(result.status == null ? 1 : result.status);
