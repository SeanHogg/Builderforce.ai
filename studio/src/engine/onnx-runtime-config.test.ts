import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression guard for the `_OrtGetInputOutputMetadata is not a function` bug:
 * the ORT WASM CDN version MUST be derived from the installed onnxruntime-web
 * JS version. A hardcoded/divergent version loads a WASM binary whose ABI
 * doesn't match the JS, breaking every InferenceSession.create().
 *
 * We mock both ORT-bearing modules so the config runs in node without a browser
 * or a real WASM download. The mocked `versions.common` is a deliberately fake
 * version — if the code ever hardcodes a real version again, the `toContain`
 * assertions fail.
 */

const ortEnv = {
  versions: { common: '9.9.9-test' as string | undefined },
  wasm: {} as Record<string, unknown>,
};
vi.mock('onnxruntime-web', () => ({ env: ortEnv }));

const hfEnv = {
  allowLocalModels: true,
  backends: { onnx: { wasm: {} as Record<string, unknown> } },
};
vi.mock('@huggingface/transformers', () => ({ env: hfEnv }));

describe('configureOnnxRuntime', () => {
  beforeEach(() => {
    // Fresh module each test so the idempotent `configured` guard resets.
    vi.resetModules();
    ortEnv.versions.common = '9.9.9-test';
    ortEnv.wasm = {};
    hfEnv.allowLocalModels = true;
    hfEnv.backends.onnx.wasm = {};
  });

  it('pins the WASM CDN to the installed onnxruntime-web version (no hardcoded drift)', async () => {
    const { configureOnnxRuntime } = await import('./onnx-runtime-config');
    configureOnnxRuntime();

    expect(ortEnv.wasm.wasmPaths).toBe(
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@9.9.9-test/dist/',
    );
    // The version in the URL must equal the runtime version — catches a hardcode.
    expect(ortEnv.wasm.wasmPaths).toContain(ortEnv.versions.common);
    // transformers.js side gets the same path + allowLocalModels off.
    expect(hfEnv.backends.onnx.wasm.wasmPaths).toBe(ortEnv.wasm.wasmPaths);
    expect(hfEnv.allowLocalModels).toBe(false);
  });

  it('tracks a different installed version (proves the URL is derived, not constant)', async () => {
    ortEnv.versions.common = '2.0.0-other';
    const { configureOnnxRuntime } = await import('./onnx-runtime-config');
    configureOnnxRuntime();
    expect(ortEnv.wasm.wasmPaths).toBe(
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@2.0.0-other/dist/',
    );
  });

  it('falls back to the unpinned CDN when the version is unavailable', async () => {
    ortEnv.versions.common = undefined;
    const { configureOnnxRuntime } = await import('./onnx-runtime-config');
    configureOnnxRuntime();
    expect(ortEnv.wasm.wasmPaths).toBe('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/');
  });

  it('defaults to single-threaded but honours an override', async () => {
    const { configureOnnxRuntime } = await import('./onnx-runtime-config');
    configureOnnxRuntime({ numThreads: 4 });
    expect(ortEnv.wasm.numThreads).toBe(4);
  });
});
