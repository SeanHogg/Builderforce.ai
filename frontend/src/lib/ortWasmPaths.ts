/** Same-origin home of the ONNX runtime's `.wasm`, published by `scripts/copy-ort-runtime.mjs`. */
export const WEB_ORT_WASM_PATH = '/ort/';

/**
 * Where `ort.env.wasm.wasmPaths` should point: the host's runtime copy when the
 * host serves one (the VS Code webview), else the app's own `/ort/`.
 */
export function resolveOrtWasmPaths(hostBase: string | null): string {
  if (!hostBase) return WEB_ORT_WASM_PATH;
  return hostBase.endsWith('/') ? hostBase : `${hostBase}/`;
}
