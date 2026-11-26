import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { realModuleFiles, removeStamp, writeStamp } from './buildInputs.mjs';

/**
 * Vite plugins that record what the webview build read, so `scripts/webview-build-if-changed.mjs`
 * can prove a later run would produce the same output and skip it (`buildInputs.mjs` says what the
 * stamp keys on).
 *
 * Three things are collected, because module ids alone miss inputs:
 *   - every module Rollup loaded (`getModuleIds`);
 *   - the SOURCE of every emitted asset (`new URL('./x.js', import.meta.url)` copies the file by
 *     path — a prebuilt worker, a font, a wasm — without loading it as a module);
 *   - every watch file (CSS `@import`/`composes` dependencies, files a plugin read).
 *
 * The worker bundles are NESTED builds with their own graphs, so {@link collectWorkerInputs} is
 * registered in `worker.plugins` too and adds theirs to the same set. The stamp is written in
 * `writeBundle` (post), after every output file exists, and only for a build that finished: a failed
 * build leaves no stamp. Watch mode never writes one — its `define`d build id is frozen at start.
 *
 * `startedAt` is taken when this module is evaluated, i.e. when the config loads, so an edit made
 * between config load and the first build hook is caught by the stamp's modification-time check.
 */
const loaded = new Set<string>();
const startedAt = Date.now();
let root = process.cwd();
let unresolvedAsset: string | null = null;

type BundleContext = { getModuleIds(): IterableIterator<string>; getWatchFiles(): string[] };
type BundleAsset = { type: string; originalFileNames?: string[]; originalFileName?: string | null };

function collect(context: BundleContext, bundle: Record<string, BundleAsset>): void {
  for (const id of context.getModuleIds()) loaded.add(id);
  for (const file of context.getWatchFiles()) loaded.add(file);
  for (const item of Object.values(bundle)) {
    if (item.type !== 'asset') continue;
    const sources = item.originalFileNames?.length ? item.originalFileNames : item.originalFileName ? [item.originalFileName] : [];
    for (const source of sources) {
      const file = path.resolve(root, source);
      // A source that does not resolve to a file means this path logic is wrong for it: say so, don't skip it.
      if (!fs.existsSync(file)) unresolvedAsset = source;
      loaded.add(file);
    }
  }
}

export function buildInputsStamp(buildId: string): Plugin {
  return {
    name: 'bf-build-inputs-stamp',
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      loaded.clear();
      unresolvedAsset = null;
      removeStamp();
    },
    generateBundle(_options, bundle) {
      collect(this, bundle as Record<string, BundleAsset>);
    },
    writeBundle: {
      order: 'post',
      handler() {
        if (this.meta.watchMode) return;
        for (const file of this.getWatchFiles()) loaded.add(file);
        if (unresolvedAsset) {
          this.warn(`no build-inputs stamp: asset source "${unresolvedAsset}" is not a file under the config root`);
          return;
        }
        try {
          if (!writeStamp({ moduleFiles: realModuleFiles(loaded), buildId, startedAt })) this.warn('an input changed during the build: no build-inputs stamp written');
        } catch (error) {
          removeStamp();
          this.warn(`build-inputs stamp not written: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    },
  };
}

/** For `worker.plugins`: contributes a worker bundle's modules, assets and watch files to the stamp. */
export function collectWorkerInputs(): Plugin {
  return {
    name: 'bf-build-inputs-worker',
    configResolved(config) {
      root = config.root;
    },
    generateBundle(_options, bundle) {
      collect(this, bundle as Record<string, BundleAsset>);
    },
  };
}
