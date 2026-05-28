/**
 * Single source of truth for ONNX Runtime configuration across the host app.
 *
 * Two ONNX runtimes coexist in the browser process:
 *   - `onnxruntime-web` (raw) — owns text-encoder + UNet + VAE sessions.
 *   - `@huggingface/transformers` — bundles its own ORT instance (unused by
 *     this engine, which only uses transformers.js for pure-JS tokenization,
 *     but configured here for safety).
 *
 * Both need identical `wasm.wasmPaths` + `wasm.numThreads`. Setting them in one
 * place avoids the "configured here but not there" trap.
 *
 * The WASM files load from a CDN — they would otherwise add ~25 MiB to the
 * Cloudflare deploy (per-asset limit is 25 MiB; the JSEP variant is at the
 * limit). CRITICAL: the CDN version MUST match the installed onnxruntime-web
 * JS version, or the WASM/JS ABI mismatches and you get errors like
 * `_OrtGetInputOutputMetadata is not a function`. So the default CDN URL is
 * derived from `ort.env.versions.common` at runtime, not hardcoded.
 */

import * as ort from 'onnxruntime-web';
import { env as hfEnv } from '@huggingface/transformers';

export interface OnnxRuntimeConfigOptions {
  /** Override the CDN base URL for ORT WASM files. Default: jsdelivr pinned to the
   *  installed onnxruntime-web version so WASM and JS ABIs match. */
  wasmCdn?: string;
  /** Override the thread count. Default: 1 (browser COOP/COEP isolation overhead is not worth it). */
  numThreads?: number;
}

/** jsdelivr CDN base for the ORT version actually loaded in this process. */
function versionMatchedCdn(): string {
  const version = ort.env?.versions?.common;
  // Pin to the exact installed version so the WASM binary matches the JS ABI.
  // Fall back to the unpinned latest only if the version is somehow unavailable.
  return version
    ? `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`
    : 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
}

let configured = false;

/**
 * Idempotent. Safe to call from multiple modules — only the first call applies;
 * subsequent calls noop. Both bundled ORT instances share the resulting config.
 */
export function configureOnnxRuntime(opts: OnnxRuntimeConfigOptions = {}): void {
  if (configured) return;
  configured = true;

  const wasmCdn = opts.wasmCdn ?? versionMatchedCdn();
  const numThreads = opts.numThreads ?? 1;

  // transformers.js side
  hfEnv.allowLocalModels = false;
  if (hfEnv.backends?.onnx?.wasm) {
    hfEnv.backends.onnx.wasm.numThreads = numThreads;
    hfEnv.backends.onnx.wasm.wasmPaths = wasmCdn;
  }

  // raw onnxruntime-web side
  ort.env.wasm.wasmPaths = wasmCdn;
  ort.env.wasm.numThreads = numThreads;
}
