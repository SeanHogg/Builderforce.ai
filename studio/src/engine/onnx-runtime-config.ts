/**
 * Single source of truth for ONNX Runtime configuration across the host app.
 *
 * Two ONNX runtimes coexist in the browser process:
 *   - `onnxruntime-web` (raw) — owns UNet + VAE sessions in the studio.
 *   - `@huggingface/transformers` — bundles its own ORT instance for the
 *     tokenizer + text-encoder.
 *
 * Both need identical `wasm.wasmPaths` + `wasm.numThreads` settings. Setting
 * them in one place avoids the "configured here but not there" trap that the
 * frontend's webgpu-trainer.ts and the studio's diffusion-engine.ts were both
 * sliding toward.
 *
 * The WASM files themselves are loaded from a CDN — they would otherwise add
 * ~25 MiB to the Cloudflare deploy (per-asset limit is 25 MiB; the JSEP
 * variant alone is at the limit). Browser caches the CDN response after the
 * first visit so cold-start cost is one-time per cache lifetime.
 */

import * as ort from 'onnxruntime-web';
import { env as hfEnv } from '@huggingface/transformers';

const DEFAULT_ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';

export interface OnnxRuntimeConfigOptions {
  /** Override the CDN base URL for ORT WASM files. Default: jsdelivr @1.21.0. */
  wasmCdn?: string;
  /** Override the thread count. Default: 1 (browser COOP/COEP isolation overhead is not worth it). */
  numThreads?: number;
}

let configured = false;

/**
 * Idempotent. Safe to call from multiple modules — only the first call applies;
 * subsequent calls noop. Both bundled ORT instances share the resulting config.
 */
export function configureOnnxRuntime(opts: OnnxRuntimeConfigOptions = {}): void {
  if (configured) return;
  configured = true;

  const wasmCdn = opts.wasmCdn ?? DEFAULT_ORT_CDN;
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
