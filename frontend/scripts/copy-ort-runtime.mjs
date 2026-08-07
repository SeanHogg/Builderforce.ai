/**
 * Publishes the ONNX runtime's `.wasm` under `public/ort/`.
 *
 * WHY this exists: the VS Code Creation Canvas is the same React canvas this app
 * renders, compiled for a webview. On-device voice cloning needs the ONNX
 * runtime, but bundling it would add ~21 MB to every VSIX download for a feature
 * most sessions never open — so the extension omits it and points the runtime at
 * `https://builderforce.ai/ort/` instead (see `CanvasHost.wasmBaseUrl`). These
 * files are what it fetches, on first use only.
 *
 * The copies are byte-identical to what `@huggingface/transformers` resolves, so
 * the editor runs the exact runtime build the library is tested against.
 *
 * Run from `prebuild`, so a deploy always carries a runtime matching the
 * installed dependency rather than a stale committed blob.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'ort');

/**
 * Cloudflare rejects a static asset over 25 MiB, and the deploy failure surfaces
 * far from this file. Fail here instead, where the fix is obvious.
 */
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

/**
 * Locate onnxruntime-web's `dist`.
 *
 * `require.resolve('onnxruntime-web/package.json')` does NOT work: the package
 * publishes an `exports` map without a `./package.json` entry, so Node refuses
 * the subpath. Resolve the main entry instead and walk up to the package root.
 */
function distDir() {
  const direct = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
  if (fs.existsSync(direct)) return direct;
  // Fall back to real resolution (hoisted / non-pnpm layouts).
  let dir = path.dirname(require.resolve('onnxruntime-web'));
  for (let depth = 0; depth < 5; depth += 1) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'dist'))) {
      return path.join(dir, 'dist');
    }
    dir = path.dirname(dir);
  }
  throw new Error('onnxruntime-web dist not found');
}

function main() {
  let dist;
  try {
    dist = distDir();
  } catch {
    console.warn('[ort] onnxruntime-web is not installed — skipping /ort publish.');
    return;
  }

  const wasm = fs.readdirSync(dist).filter((file) => file.endsWith('.wasm'));
  if (!wasm.length) {
    console.warn(`[ort] no .wasm found in ${dist} — skipping.`);
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const oversized = [];
  let copied = 0;

  for (const file of wasm) {
    const from = path.join(dist, file);
    const to = path.join(OUT, file);
    const { size } = fs.statSync(from);
    if (size > MAX_ASSET_BYTES) {
      // Not fatal on its own: the runtime picks ONE variant at init, and the
      // build only breaks if the variant it picks is the missing one.
      oversized.push({ file, size });
      continue;
    }
    // Skip an unchanged copy so `prebuild` stays cheap on repeat runs.
    if (!fs.existsSync(to) || fs.statSync(to).size !== size) fs.copyFileSync(from, to);
    copied += 1;
  }

  console.log(`[ort] published ${copied} runtime file(s) to public/ort/`);

  if (oversized.length) {
    for (const { file, size } of oversized) {
      console.error(
        `[ort] ${file} is ${(size / 1024 / 1024).toFixed(2)} MiB, over the 25 MiB ` +
          `static-asset limit — not published. If the editor canvas needs this variant, ` +
          `serve it from R2 and point CanvasHost.wasmBaseUrl there.`,
      );
    }
    // A silently missing runtime variant is a 404 at voice-clone time, in an
    // editor panel, weeks later. Fail the build instead.
    process.exitCode = 1;
  }
}

main();
