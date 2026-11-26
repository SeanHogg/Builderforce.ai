#!/usr/bin/env node
/**
 * `bundle:webview`: runs `vite build --config webview/vite.config.ts` unless a content-hash stamp
 * proves `media/webview/` is already the output of the current inputs.
 *
 * The stamp (`webview/buildInputs.mjs` says exactly what it keys on) is written by the vite plugin in
 * `webview/buildInputsStamp.ts` at the end of every successful build, so the plain `vite build` path
 * keeps it fresh. Anything unsure — no output, no stamp, a read error, a changed input, output that
 * no longer matches the stamp, `BF_FORCE_BUILD=1` — builds. A skip must never ship stale output.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const vscodeDir = fileURLToPath(new URL('..', import.meta.url));

/** Why to build, or null when the stamp proves the output current. Never throws: doubt is a build. */
async function reasonToBuild() {
  if (process.env.BF_FORCE_BUILD === '1') return 'BF_FORCE_BUILD=1';
  try {
    const { rebuildReason } = await import('../webview/buildInputs.mjs');
    return rebuildReason();
  } catch (error) {
    return `could not verify the stamp (${error instanceof Error ? error.message : String(error)})`;
  }
}

const reason = await reasonToBuild();
if (reason === null) {
  console.log('[webview] inputs unchanged; skipping vite build');
  process.exit(0);
}
console.log(`[webview] building: ${reason}`);
/** vite's CLI entry from clients/vscode's own install, so this works without node_modules/.bin on PATH. */
function resolveViteBin() {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('vite/package.json');
  const { bin } = require(pkgPath);
  const rel = typeof bin === 'string' ? bin : bin.vite;
  return join(dirname(pkgPath), rel);
}

const build = spawnSync(process.execPath, [resolveViteBin(), 'build', '--config', 'webview/vite.config.ts'], {
  cwd: vscodeDir,
  stdio: 'inherit',
  shell: false,
});
if (build.error) console.error(`[webview] could not run vite: ${build.error.message}`);
process.exit(build.status ?? 1);
