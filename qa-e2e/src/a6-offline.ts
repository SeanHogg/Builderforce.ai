/**
 * Direct runner for the PRD 41 §A6 packaged offline acceptance scenario.
 *
 * The default `playwright test` entry mints an authenticated browser session in
 * globalSetup — wrong for this scenario, which is a self-contained VS Code
 * launch that must run with NO sign-in and NO BuilderForce API. This runner
 * invokes Playwright with the anonymous config and forwards the scenario's
 * `--small` scale flag.
 *
 *   pnpm tsx src/a6-offline.ts -- --small
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const passthrough = args.includes('--') ? args.slice(args.indexOf('--') + 1) : args;

const spec = path.resolve(HERE, '..', 'tests', 'vsix-offline-acceptance.spec.ts');
const config = path.resolve(HERE, '..', 'playwright.offline.config.ts');

// The Playwright CLI is not a public package export — invoke the installed bin shim.
const bin = process.platform === 'win32' ? 'playwright.cmd' : 'playwright';
const cli = path.resolve(HERE, '..', 'node_modules', '.bin', bin);
if (!fs.existsSync(cli)) {
  console.error(`[a6:offline] Playwright bin not found at ${cli} — run pnpm install in qa-e2e first.`);
  process.exit(1);
}

const res = spawnSync(cli, ['test', spec, '-c', config, ...passthrough], { stdio: 'inherit' });
process.exit(res.status ?? 1);
