import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolveOrtWasmPaths } from './ortWasmPaths';

const require = createRequire(import.meta.url);
const { MAX_ASSET_BYTES, ortWasmDecision } = require('../../scripts/cloudflareAssetCap.cjs') as {
  MAX_ASSET_BYTES: number;
  ortWasmDecision: (name: string, size: number) => 'strip' | 'keep';
};

describe('resolveOrtWasmPaths', () => {
  it('defaults to same-origin /ort/ on the web', () => {
    expect(resolveOrtWasmPaths(null)).toBe('/ort/');
  });
  it('keeps the host override, normalising the trailing slash', () => {
    expect(resolveOrtWasmPaths('https://builderforce.ai/ort')).toBe('https://builderforce.ai/ort/');
    expect(resolveOrtWasmPaths('https://builderforce.ai/ort/')).toBe('https://builderforce.ai/ort/');
  });
});

describe('ortWasmDecision (strip-worker-assets pass 2)', () => {
  it('keeps the pinned runtime files, which are under the cap', () => {
    expect(ortWasmDecision('ort-wasm-simd-threaded.jsep.wasm', 21_596_019)).toBe('keep');
    expect(ortWasmDecision('ort-wasm-simd-threaded.wasm', 11_133_407)).toBe('keep');
  });
  it('strips an ORT wasm over the cap, and only at it', () => {
    expect(ortWasmDecision('ort-wasm-simd-threaded.jsep.wasm', MAX_ASSET_BYTES)).toBe('keep');
    expect(ortWasmDecision('ort-wasm-simd-threaded.jsep.wasm', MAX_ASSET_BYTES + 1)).toBe('strip');
  });
  it('never touches non-ORT files', () => {
    expect(ortWasmDecision('other.wasm', MAX_ASSET_BYTES * 2)).toBe('keep');
  });
});
