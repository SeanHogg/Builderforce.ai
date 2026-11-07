import { describe, expect, it, vi } from 'vitest';
vi.mock('./pageEngines/webgpu', () => ({ hasWebGPU: () => true }));
import { hasWebGPU } from './pageEngines/webgpu';
import * as webgpuReal from './pageEngines/webgpu';
describe('probe', () => {
  it('sees the mock', () => {
    console.log('hasWebGPU()', hasWebGPU());
    console.log('module keys', Object.keys(webgpuReal));
    expect(hasWebGPU()).toBe(true);
  });
});
