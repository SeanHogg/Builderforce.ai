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
let hostWasmBase: string | null = null;
/** An explicit `wasmCdn` option from the configuring call; kept so a later base change reverts to it. */
let lastOptionWasmCdn: string | null = null;

/**
 * The host app's own copy of the ORT WASM (e.g. same-origin `/ort/`). Wins over the
 * jsDelivr default, which exists only for third-party npm consumers that set no
 * base — and which a strict CSP (`script-src` without the CDN) blocks. Safe to call
 * before or after {@link configureOnnxRuntime}: if the runtime is already configured
 * the new base is applied at once. An explicit `wasmCdn` option still wins.
 */
export function setOrtWasmBase(url: string | null): void {
  hostWasmBase = url ? (url.endsWith('/') ? url : `${url}/`) : null;
  // Re-apply the effective path (null reverts to the default); a never-set `configured`
  // runtime picks it up when `configureOnnxRuntime` runs.
  if (configured) applyWasmPaths(lastOptionWasmCdn ?? hostWasmBase ?? versionMatchedCdn());
}

/** The `env` of the `onnxruntime-web/webgpu` instance @webdit/runtime imports — a SECOND
 *  ORT module instance, with its own `env`. Null until {@link configureWebGpuOrt} loads it. */
type OrtWasmEnv = { wasm: { wasmPaths?: unknown; numThreads?: number } };
let webgpuEnv: OrtWasmEnv | null = null;
let appliedWasmPaths: string | null = null;
let appliedNumThreads: number | null = null;

function applyToWebGpuOrt(): void {
  if (!webgpuEnv) return;
  if (appliedWasmPaths) webgpuEnv.wasm.wasmPaths = appliedWasmPaths;
  if (appliedNumThreads !== null) webgpuEnv.wasm.numThreads = appliedNumThreads;
}

/**
 * Bring the `onnxruntime-web/webgpu` instance (the one webdit's runners use) onto the
 * same WASM base and thread count as the main instance. Call it before the first
 * webdit session; afterwards {@link setOrtWasmBase} keeps it in step. Lazy, so a
 * consumer that never runs webdit never loads the WebGPU build.
 */
export async function configureWebGpuOrt(): Promise<void> {
  const mod = await import('onnxruntime-web/webgpu');
  webgpuEnv = (mod as { env?: OrtWasmEnv }).env?.wasm ? (mod as unknown as { env: OrtWasmEnv }).env : null;
  applyToWebGpuOrt();
}

function applyWasmPaths(wasmPaths: string): void {
  if (hfEnv.backends?.onnx?.wasm) hfEnv.backends.onnx.wasm.wasmPaths = wasmPaths;
  ort.env.wasm.wasmPaths = wasmPaths;
  appliedWasmPaths = wasmPaths;
  applyToWebGpuOrt();
}

/**
 * Idempotent. Safe to call from multiple modules — only the first call applies;
 * subsequent calls noop. Both bundled ORT instances share the resulting config.
 */
export function configureOnnxRuntime(opts: OnnxRuntimeConfigOptions = {}): void {
  if (configured) return;
  configured = true;

  lastOptionWasmCdn = opts.wasmCdn ?? null;
  const wasmPaths = opts.wasmCdn ?? hostWasmBase ?? versionMatchedCdn();
  const numThreads = opts.numThreads ?? 1;

  // transformers.js side
  hfEnv.allowLocalModels = false;
  if (hfEnv.backends?.onnx?.wasm) hfEnv.backends.onnx.wasm.numThreads = numThreads;

  // both runtimes share one path
  applyWasmPaths(wasmPaths);
  ort.env.wasm.numThreads = numThreads;
  appliedNumThreads = numThreads;
  applyToWebGpuOrt();
}
