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

// The SECOND ORT instance @webdit/runtime imports; it has its own env.
const webgpuEnv = { wasm: {} as Record<string, unknown> };
vi.mock('onnxruntime-web/webgpu', () => ({ env: webgpuEnv }));

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
    webgpuEnv.wasm = {};
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

  it('a host base wins over the CDN default, whichever order it is set in', async () => {
    const { configureOnnxRuntime, setOrtWasmBase } = await import('./onnx-runtime-config');
    setOrtWasmBase('/ort');
    configureOnnxRuntime();
    expect(ortEnv.wasm.wasmPaths).toBe('/ort/');
    expect(hfEnv.backends.onnx.wasm.wasmPaths).toBe('/ort/');

    // Set after configuration: applied at once, not overwritten later.
    setOrtWasmBase('https://builderforce.ai/ort/');
    expect(ortEnv.wasm.wasmPaths).toBe('https://builderforce.ai/ort/');
  });

  it('setOrtWasmBase(null) after configuration reverts to the version-pinned default', async () => {
    const { configureOnnxRuntime, setOrtWasmBase } = await import('./onnx-runtime-config');
    setOrtWasmBase('/ort/');
    configureOnnxRuntime();
    expect(ortEnv.wasm.wasmPaths).toBe('/ort/');
    setOrtWasmBase(null);
    expect(ortEnv.wasm.wasmPaths).toBe('https://cdn.jsdelivr.net/npm/onnxruntime-web@9.9.9-test/dist/');
    expect(hfEnv.backends.onnx.wasm.wasmPaths).toBe(ortEnv.wasm.wasmPaths);
  });

  it('setOrtWasmBase reaches the onnxruntime-web/webgpu instance too, before and after it loads', async () => {
    const { configureOnnxRuntime, configureWebGpuOrt, setOrtWasmBase } = await import('./onnx-runtime-config');
    setOrtWasmBase('/ort');
    configureOnnxRuntime({ numThreads: 2 });
    // Loading the webgpu instance adopts the already-applied base and thread count.
    await configureWebGpuOrt();
    expect(webgpuEnv.wasm.wasmPaths).toBe('/ort/');
    expect(webgpuEnv.wasm.numThreads).toBe(2);

    // A later change reaches both instances.
    setOrtWasmBase('https://builderforce.ai/ort/');
    expect(ortEnv.wasm.wasmPaths).toBe('https://builderforce.ai/ort/');
    expect(webgpuEnv.wasm.wasmPaths).toBe('https://builderforce.ai/ort/');
  });

  it('defaults to single-threaded but honours an override', async () => {
    const { configureOnnxRuntime } = await import('./onnx-runtime-config');
    configureOnnxRuntime({ numThreads: 4 });
    expect(ortEnv.wasm.numThreads).toBe(4);
  });
});
