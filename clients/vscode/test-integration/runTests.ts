/**
 * Launcher for the extension-host suite: downloads a real VS Code (cached under
 * `.vscode-test/`), installs THIS extension into it, and runs `index.ts` inside it.
 *
 * Deliberately NOT part of `pnpm test`: the first run downloads ~150 MB, so the unit
 * suite stays offline and instant while this is the pre-package gate
 * (`pnpm test:integration`).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

/** Waits between attempts to resolve VS Code; one fewer than the attempts made. */
const RESOLVE_BACKOFF_MS = [10_000, 30_000, 60_000];

/** An install folder `.vscode-test/vscode-<platform>-<x.y.z>` (not `user-data/`, `extensions/`). */
const INSTALL_DIR = /^vscode-[a-z0-9-]+-\d+\.\d+/;

/**
 * Resolve and download VS Code, retrying transient network failures.
 *
 * The launcher's first network call asks `update.code.visualstudio.com` which stable
 * version satisfies `engines.vscode`. That lookup is NOT retried by the library and
 * only falls back to an already-cached install — so on a fresh CI runner one dropped
 * connection (`connect ETIMEDOUT`) failed the whole release before a single test ran.
 * The library retries the archive download itself; this covers the lookup too. With a
 * cached install present (see the release workflow's cache step) an unreachable update
 * service resolves to that install instead of throwing, so no retry is spent.
 */
async function resolveVSCode(extensionDevelopmentPath: string, cachePath: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await downloadAndUnzipVSCode({ extensionDevelopmentPath, cachePath, timeout: 60_000 });
    } catch (err) {
      const wait = RESOLVE_BACKOFF_MS[attempt];
      if (wait === undefined) throw err;
      console.warn(`resolving VS Code failed (attempt ${attempt + 1}); retrying in ${wait / 1000}s:`, err);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/**
 * Delete every cached install except the one about to run. Each new stable release
 * lands in a new folder, so without this `.vscode-test/` (and the CI cache built from
 * it) grows by ~320 MB per VS Code release forever.
 */
async function pruneStaleInstalls(cachePath: string, vscodeExecutablePath: string): Promise<void> {
  const inUse = path.relative(cachePath, vscodeExecutablePath).split(path.sep)[0];
  const entries = await fs.readdir(cachePath).catch((): string[] => []);
  await Promise.all(
    entries
      .filter((entry) => INSTALL_DIR.test(entry) && entry !== inUse)
      .map((entry) => fs.rm(path.join(cachePath, entry), { recursive: true, force: true })),
  );
}

/**
 * Strip the Electron/VS Code variables the SURROUNDING editor exports.
 *
 * The common way to run this is a terminal inside VS Code, and a VS Code integrated
 * terminal (or an extension-host child process) exports `ELECTRON_RUN_AS_NODE=1`. The
 * downloaded `Code.exe` inherits it, starts as plain Node instead of Electron, and
 * rejects every flag it is handed — `Code.exe: bad option: --extensionTestsPath`,
 * exit 9 — which reads like a broken launcher rather than a leaked variable. The
 * `VSCODE_*` handles (IPC pipe, PID, NLS config) belong to the outer instance too and
 * confuse the inner one, so they go with it.
 */
function cleanElectronEnv(): void {
  // Mutating THIS process's env is what actually works: the launcher spawns
  // `Code.exe` with `process.env` as the base and merges `extensionTestsEnv` on top,
  // so a key deleted from a copy is still inherited from the original.
  delete process.env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VSCODE_')) delete process.env[key];
  }
}

async function main(): Promise<void> {
  cleanElectronEnv();
  // `out-integration/` sits beside `out/`, so both resolve relative to the extension
  // root — which is what VS Code is handed as `--extensionDevelopmentPath`.
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, './suite.cjs');
  const cachePath = path.join(extensionDevelopmentPath, '.vscode-test');
  const vscodeExecutablePath = await resolveVSCode(extensionDevelopmentPath, cachePath);
  await pruneStaleInstalls(cachePath, vscodeExecutablePath).catch((err) =>
    console.warn('could not prune stale VS Code installs:', err),
  );
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      // No user extensions and a clean profile: the assertions are about OUR
      // contributions, and a stray extension registering a `builderforce.*` command
      // would otherwise fail the "registered but undeclared" check.
      '--disable-extensions',
      '--disable-gpu',
      // A workspace-less window. Nothing here needs a folder, and opening one would
      // make the run depend on whatever is in it.
      '--disable-workspace-trust',
    ],
  });
}

main().catch((err) => {
  console.error('extension-host tests failed:', err);
  process.exit(1);
});
