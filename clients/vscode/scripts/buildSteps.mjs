/**
 * The extension's build steps and the presets that chain them — the ONE list `prepublish.mjs` runs
 * (`vscode:prepublish`, `compile` and `build:webview` are presets of it, not three copies of a chain).
 *
 * Every step runs from `clients/vscode` with the caller's environment, so what `vsce-platform.mjs`
 * sets for the package (`BFI_NATIVE_TARGET`, read by `esbuild.mjs`'s `copyBfiNative`) reaches the
 * step that needs it. A step is `{ name, command, args, shell? }`.
 */
const FRONTEND = '../../frontend';

const node = (name, ...args) => ({ name, command: process.execPath, args });

export const STEPS = {
  ranges: node('check-installed-ranges', '../../scripts/check-installed-ranges.mjs', '.'),
  priceSnapshot: node('gen-price-snapshot', '../../scripts/gen-price-snapshot.mjs'),
  linkedDeps: node('ensure-linked-deps', '../../scripts/ensure-linked-deps.mjs', FRONTEND),
  linkedBuilds: node('ensure-linked-builds', '../../scripts/ensure-linked-builds.mjs', '.', FRONTEND),
  /** The webview alone consumes the frontend's links, never the extension's own. */
  linkedBuildsFrontend: node('ensure-linked-builds', '../../scripts/ensure-linked-builds.mjs', FRONTEND),
  esbuildProduction: node('esbuild --production', 'esbuild.mjs', '--production'),
  esbuildDev: node('esbuild', 'esbuild.mjs'),
  // Through the package script so `vite` resolves from node_modules/.bin, as before.
  webview: { name: 'bundle:webview', command: 'pnpm', args: ['run', 'bundle:webview'], shell: process.platform === 'win32' },
};

/** Preset name -> ordered step names. `prepublish` is the default. */
export const PRESETS = {
  prepublish: ['ranges', 'priceSnapshot', 'linkedDeps', 'linkedBuilds', 'esbuildProduction', 'webview'],
  compile: ['linkedDeps', 'linkedBuilds', 'esbuildDev', 'webview'],
  webview: ['linkedDeps', 'linkedBuildsFrontend', 'webview'],
};
