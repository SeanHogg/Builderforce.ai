/**
 * Launcher for the extension-host suite: downloads a real VS Code (cached under
 * `.vscode-test/`), installs THIS extension into it, and runs `index.ts` inside it.
 *
 * Deliberately NOT part of `pnpm test`: the first run downloads ~150 MB, so the unit
 * suite stays offline and instant while this is the pre-package gate
 * (`pnpm test:integration`).
 */

import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

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
  await runTests({
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
