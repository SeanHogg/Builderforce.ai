import { describe, expect, it } from 'vitest';
import {
  LOCAL_MODEL_CATALOG,
  LOCAL_RUNTIMES,
  localCatalogFor,
  localCatalogModel,
  localModelFit,
  parseLocalModelRef,
  type LocalDeviceSupport,
} from './index.js';

/**
 * The page engines' catalog and the device fit check. The catalog is DATA that three
 * readers trust blindly (picker, fit, download manager), so its invariants are pinned
 * here rather than discovered as a 404 halfway through a gigabyte download.
 */

describe('LOCAL_MODEL_CATALOG', () => {
  it('has unique refs, each parsing back to its own runtime and model', () => {
    const refs = LOCAL_MODEL_CATALOG.map((m) => m.ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const m of LOCAL_MODEL_CATALOG) {
      expect(parseLocalModelRef(m.ref)).toEqual({ provider: m.runtime, model: m.model });
    }
  });

  it('names only page runtimes that exist in the registry', () => {
    for (const m of LOCAL_MODEL_CATALOG) {
      const runtime = LOCAL_RUNTIMES.find((r) => r.id === m.runtime);
      expect(runtime, m.ref).toBeDefined();
      expect(runtime!.reach).toBe('page');
      expect(runtime!.onDevice).toBe(true);
    }
  });

  it('carries a well-formed source for its engine', () => {
    for (const m of LOCAL_MODEL_CATALOG) {
      if (m.source.kind === 'hf-file') {
        expect(m.runtime).toBe('bfi');
        expect(m.source.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
        expect(m.source.file).toMatch(/\.gguf$/);
      } else {
        expect(m.runtime).toBe('webllm');
        expect(m.source.modelId).toBe(m.model);
        expect(m.source.modelId).toMatch(/-MLC$/);
      }
    }
  });

  it('declares positive sizes, windows and buffer needs', () => {
    for (const m of LOCAL_MODEL_CATALOG) {
      expect(m.bytes).toBeGreaterThan(0);
      expect(m.params).toBeGreaterThan(0);
      expect(m.contextTokens).toBeGreaterThan(0);
      expect(m.requires.minBufferBytes).toBeGreaterThan(0);
    }
  });

  it('marks every bfi model tool-capable (grammar-constrained) and WebLLM only per model', () => {
    expect(localCatalogFor('bfi').every((m) => m.tools)).toBe(true);
    const webllmTools = localCatalogFor('webllm').filter((m) => m.tools).map((m) => m.model);
    expect(webllmTools).toEqual(['Hermes-3-Llama-3.1-8B-q4f16_1-MLC']);
  });

  it('gives every bfi row the KV shape its served context is planned from', () => {
    for (const m of localCatalogFor('bfi')) {
      expect(m.kv, m.ref).toBeDefined();
      expect(m.kv!.layers * m.kv!.kvHeads * m.kv!.headDim).toBeGreaterThan(0);
    }
  });

  it('looks a row up by ref', () => {
    expect(localCatalogModel('local/bfi/bonsai-8b-q1_0')?.source).toEqual({
      kind: 'hf-file',
      repo: 'prism-ml/Bonsai-8B-gguf',
      file: 'Bonsai-8B-Q1_0.gguf',
    });
    expect(localCatalogModel('local/ollama/qwen3:8b')).toBeUndefined();
  });
});

describe('localModelFit', () => {
  const gpu: LocalDeviceSupport = { supported: true, f16: true, maxBufferBytes: 2 ** 30 };
  const requires = (r: { f16?: boolean; minBufferBytes: number }) => ({ requires: r });

  it('fits a model the device covers', () => {
    expect(localModelFit(requires({ f16: true, minBufferBytes: 2 ** 27 }), gpu)).toEqual({ fits: true });
  });

  it('refuses without WebGPU, carrying the engine reason', () => {
    expect(localModelFit(requires({ minBufferBytes: 1 }), { ...gpu, supported: false, reason: 'no adapter' })).toEqual({
      fits: false,
      reason: 'webgpu_unavailable',
      detail: 'no adapter',
    });
  });

  it('refuses an f16 model when shader-f16 is not offered, but not an f32-safe one', () => {
    const noF16 = { ...gpu, f16: false };
    expect(localModelFit(requires({ f16: true, minBufferBytes: 1 }), noF16)).toMatchObject({
      reason: 'shader_f16_unavailable',
    });
    expect(localModelFit(requires({ minBufferBytes: 1 }), noF16)).toEqual({ fits: true });
  });

  it('refuses when the largest binding is smaller than the model needs', () => {
    expect(localModelFit(requires({ minBufferBytes: 2 ** 30 }), { ...gpu, maxBufferBytes: 2 ** 27 })).toMatchObject({
      reason: 'buffer_too_small',
    });
  });

  it('uses the storage binding limit rather than the independent allocation limit', () => {
    const support: LocalDeviceSupport = {
      contractVersion: 2,
      supported: true,
      f16: true,
      maxBufferBytes: 2 ** 30,
      maxBufferSizeBytes: 2 ** 40,
      maxStorageBufferBindingSizeBytes: 2 ** 27,
    };
    expect(localModelFit(requires({ minBufferBytes: 2 ** 28 }), support)).toMatchObject({ reason: 'buffer_too_small' });
  });

  it('fits every bfi Bonsai row on a WebGPU-default adapter without shader-f16', () => {
    const baseline: LocalDeviceSupport = { supported: true, f16: false, maxBufferBytes: 128 * 1024 * 1024 };
    for (const m of localCatalogFor('bfi')) expect(localModelFit(m, baseline)).toEqual({ fits: true });
  });
});
