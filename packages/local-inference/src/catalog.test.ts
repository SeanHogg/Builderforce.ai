import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_MODEL_CATALOG,
  LOCAL_MODEL_USES,
  LOCAL_RUNTIMES,
  BFI_CPU_LIMITS,
  VRAM_PER_MAX_BUFFER,
  assumedDeviceMemoryBytes,
  cpuMemoryCeiling,
  isLocalChatModel,
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
        expect(m.source.modelId).toMatch(/-MLC(?:-\w+)?$/);
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
    // WebLLM 0.2.84's `functionCallingModelIds`, q4f16 builds only.
    const webllmTools = localCatalogFor('webllm').filter((m) => m.tools).map((m) => m.model).sort();
    expect(webllmTools).toEqual([
      'Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC',
      'Hermes-2-Pro-Mistral-7B-q4f16_1-MLC',
      'Hermes-3-Llama-3.1-8B-q4f16_1-MLC',
    ]);
  });

  it('keeps the refs hosts have already pinned or downloaded', () => {
    for (const model of [
      'Qwen3-1.7B-q4f16_1-MLC',
      'Llama-3.2-3B-Instruct-q4f16_1-MLC',
      'Qwen3-4B-q4f16_1-MLC',
      'Hermes-3-Llama-3.1-8B-q4f16_1-MLC',
    ]) {
      expect(localCatalogModel(`local/webllm/${model}`), model).toBeDefined();
    }
  });

  it('offers the WebLLM library, q4f16 builds plus the embedders, and nothing over 24 GB', () => {
    const webllm = LOCAL_MODEL_CATALOG.filter((m) => m.runtime === 'webllm');
    expect(webllm.length).toBeGreaterThan(50);
    for (const m of webllm) {
      expect(m.requires.vramBytes, m.ref).toBeGreaterThan(0);
      expect(m.requires.vramBytes!, m.ref).toBeLessThanOrEqual(24_000 * 1024 * 1024);
      if (m.uses.includes('embedding')) expect(m.model).toMatch(/q0f32/);
      else expect(m.model).not.toMatch(/f32/);
    }
  });

  it('describes every row by at least one known use, and curates some per use', () => {
    for (const m of LOCAL_MODEL_CATALOG) {
      expect(m.uses.length, m.ref).toBeGreaterThan(0);
      for (const use of m.uses) expect(LOCAL_MODEL_USES).toContain(use);
    }
    const recommended = LOCAL_MODEL_CATALOG.filter((m) => m.recommended);
    for (const use of ['chat', 'coding', 'reasoning', 'math', 'embedding'] as const) {
      expect(recommended.some((m) => m.uses.includes(use)), use).toBe(true);
    }
    expect(localCatalogFor('bfi').every((m) => m.recommended && m.uses.includes('chat'))).toBe(true);
  });

  it('never offers an embedding or vision-only build as a chat model', () => {
    const embedders = LOCAL_MODEL_CATALOG.filter((m) => m.uses.includes('embedding'));
    const vision = LOCAL_MODEL_CATALOG.filter((m) => m.uses.length === 1 && m.uses[0] === 'vision');
    expect(embedders.length).toBeGreaterThan(0);
    expect(vision.length).toBeGreaterThan(0);
    const chat = new Set(localCatalogFor('webllm').map((m) => m.ref));
    for (const m of [...embedders, ...vision]) {
      expect(isLocalChatModel(m), m.ref).toBe(false);
      expect(chat.has(m.ref), m.ref).toBe(false);
      expect(localCatalogModel(m.ref)).toBe(m);
    }
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
  const requires = (r: { f16?: boolean; minBufferBytes: number; vramBytes?: number }) => ({ requires: r });

  it('fits a model the device covers', () => {
    expect(localModelFit(requires({ f16: true, minBufferBytes: 2 ** 27 }), gpu)).toEqual({ fits: true, backend: 'webgpu' });
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
    expect(localModelFit(requires({ minBufferBytes: 1 }), noF16)).toEqual({ fits: true, backend: 'webgpu' });
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

  it('refuses a model clearly larger than the adapter can allocate, and only then', () => {
    const support: LocalDeviceSupport = { ...gpu, maxBufferSizeBytes: 2 ** 30 };
    const limit = 2 ** 30 * VRAM_PER_MAX_BUFFER;
    expect(localModelFit({ requires: { minBufferBytes: 1, vramBytes: limit } }, support)).toEqual({ fits: true, backend: 'webgpu' });
    expect(localModelFit({ requires: { minBufferBytes: 1, vramBytes: limit + 1 } }, support)).toEqual({
      fits: false,
      reason: 'vram_too_small',
    });
  });

  it('treats VRAM as advisory when the adapter reports no allocation limit', () => {
    // Only the explicit v2 `maxBufferSizeBytes` is read — the deprecated field is ignored.
    expect(localModelFit({ requires: { minBufferBytes: 1, vramBytes: 2 ** 40 } }, gpu)).toEqual({ fits: true, backend: 'webgpu' });
  });

  describe('the CPU backend (bfi without WebGPU)', () => {
    const GIB = 1024 ** 3;
    const noGpu = (deviceMemoryBytes?: number): LocalDeviceSupport => ({
      supported: false,
      reason: 'navigator.gpu is missing',
      f16: false,
      maxBufferBytes: 0,
      backends: {
        cpu: {
          supported: true,
          simd: true,
          threads: 1,
          kvBudgetBytes: BFI_CPU_LIMITS.cpuKvBudgetBytes,
          maxMemoryBytes: cpuMemoryCeiling(deviceMemoryBytes),
          ...(deviceMemoryBytes ? { deviceMemoryBytes } : {}),
        },
      },
    });
    const bonsai = (size: string) => localCatalogModel(`local/bfi/bonsai-${size}-q1_0`)!;

    const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
    const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
    const onDevice = (nav: Record<string, unknown>) => vi.stubGlobal('navigator', nav);
    afterEach(() => vi.unstubAllGlobals());

    it('reads the ceiling as half the RAM, capped at wasm32; an unreported RAM as 2 GiB on a phone, 8 GiB on a desktop', () => {
      expect(cpuMemoryCeiling(8 * GIB)).toBe(4 * GIB);
      expect(cpuMemoryCeiling(64 * GIB)).toBe(BFI_CPU_LIMITS.wasm32MemoryBytes);
      onDevice({ userAgent: PHONE_UA });
      expect(cpuMemoryCeiling()).toBe(1 * GIB);
      onDevice({ userAgent: DESKTOP_UA });
      expect(cpuMemoryCeiling()).toBe(4 * GIB);
    });

    it('offers only Bonsai 1.7B on the CPU of a phone that does not report its RAM', () => {
      onDevice({ userAgent: PHONE_UA });
      expect(localModelFit(bonsai('1.7b'), noGpu())).toEqual({ fits: true, backend: 'cpu' });
      expect(localModelFit(bonsai('4b'), noGpu())).toEqual({ fits: false, reason: 'memory_insufficient' });
      expect(localModelFit(bonsai('8b'), noGpu())).toEqual({ fits: false, reason: 'memory_insufficient' });
    });

    it('offers Bonsai 4B and 8B on the CPU of a desktop that does not report its RAM', () => {
      onDevice({ userAgent: DESKTOP_UA });
      expect(localModelFit(bonsai('1.7b'), noGpu())).toEqual({ fits: true, backend: 'cpu' });
      expect(localModelFit(bonsai('4b'), noGpu())).toEqual({ fits: true, backend: 'cpu' });
      expect(localModelFit(bonsai('8b'), noGpu())).toEqual({ fits: true, backend: 'cpu' });
    });

    it('reads mobile from the UA Client Hint first, and catches iPadOS posing as a Mac', () => {
      expect(assumedDeviceMemoryBytes({ userAgent: DESKTOP_UA, userAgentData: { mobile: true } })).toBe(BFI_CPU_LIMITS.assumedDeviceMemoryBytes);
      expect(assumedDeviceMemoryBytes({ userAgent: PHONE_UA, userAgentData: { mobile: false } })).toBe(BFI_CPU_LIMITS.assumedDesktopMemoryBytes);
      const iPad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
      expect(assumedDeviceMemoryBytes({ userAgent: iPad, maxTouchPoints: 5 })).toBe(BFI_CPU_LIMITS.assumedDeviceMemoryBytes);
      expect(assumedDeviceMemoryBytes({ userAgent: iPad, maxTouchPoints: 0 })).toBe(BFI_CPU_LIMITS.assumedDesktopMemoryBytes);
      // A navigator that says nothing (Node's; it passes `os.totalmem()` anyway) reads as a desktop.
      expect(assumedDeviceMemoryBytes({})).toBe(BFI_CPU_LIMITS.assumedDesktopMemoryBytes);
    });

    it('offers 4B from 4 GiB and 8B only where the device reports 8 GiB', () => {
      expect(localModelFit(bonsai('4b'), noGpu(4 * GIB))).toEqual({ fits: true, backend: 'cpu' });
      expect(localModelFit(bonsai('8b'), noGpu(4 * GIB))).toMatchObject({ reason: 'memory_insufficient' });
      expect(localModelFit(bonsai('8b'), noGpu(8 * GIB))).toEqual({ fits: true, backend: 'cpu' });
      expect(localModelFit(bonsai('1.7b'), noGpu(1 * GIB))).toMatchObject({ reason: 'memory_insufficient' });
    });

    it('counts weights + the KV budget + the working set against the ceiling, as Rust does', () => {
      const tight = noGpu(8 * GIB);
      const row = bonsai('1.7b');
      tight.backends!.cpu!.maxMemoryBytes = row.bytes + BFI_CPU_LIMITS.cpuKvBudgetBytes + BFI_CPU_LIMITS.cpuWorkingSetBytes;
      expect(localModelFit(row, tight)).toEqual({ fits: true, backend: 'cpu' });
      tight.backends!.cpu!.maxMemoryBytes -= 1;
      expect(localModelFit(row, tight)).toMatchObject({ reason: 'memory_insufficient' });
    });

    it('prefers WebGPU when it fits, and never offers a WebGPU-only row on the CPU', () => {
      const both: LocalDeviceSupport = { ...gpu, backends: noGpu(8 * GIB).backends };
      expect(localModelFit(bonsai('1.7b'), both)).toEqual({ fits: true, backend: 'webgpu' });
      const webllmRow = localCatalogFor('webllm')[0]!;
      expect(localModelFit(webllmRow, noGpu(8 * GIB))).toMatchObject({ fits: false, reason: 'webgpu_unavailable' });
    });

    it('gives every bfi row a CPU floor and no WebLLM row one', () => {
      for (const m of localCatalogFor('bfi')) expect(m.requires.cpu?.minDeviceMemoryBytes, m.ref).toBeGreaterThan(0);
      for (const m of localCatalogFor('webllm')) expect(m.requires.cpu, m.ref).toBeUndefined();
    });
  });

  it('fits every bfi Bonsai row on a WebGPU-default adapter without shader-f16', () => {
    const baseline: LocalDeviceSupport = { supported: true, f16: false, maxBufferBytes: 128 * 1024 * 1024 };
    for (const m of localCatalogFor('bfi')) expect(localModelFit(m, baseline)).toEqual({ fits: true, backend: 'webgpu' });
  });
});
