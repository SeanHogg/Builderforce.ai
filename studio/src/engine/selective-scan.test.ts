import { describe, it, expect, vi } from 'vitest';
import { selectiveScanStep, selectiveScanStepCpu, DEFAULT_SCAN_DECAY } from './selective-scan';
import { advanceState, emptyState } from './mamba-coherence';
import { SELECTIVE_SCAN_STEP_WGSL } from './kernels/selective-scan.wgsl';

describe('selectiveScanStepCpu (hand-computed reference)', () => {
  it('computes decay * h + gain * u per cell', () => {
    // 2 channels x 2 order. h = [1,2,3,4], u = [10, 20], decay 0.5, gain 0.1
    const out = selectiveScanStepCpu({
      state: [1, 2, 3, 4],
      pooled: Float32Array.from([10, 20]),
      channels: 2,
      order: 2,
      decay: 0.5,
      gain: 0.1,
    });
    // c0: 0.5*1+1=1.5, 0.5*2+1=2 ; c1: 0.5*3+2=3.5, 0.5*4+2=4
    expect(Array.from(out)).toEqual([
      Math.fround(1.5), Math.fround(2), Math.fround(3.5), Math.fround(4),
    ].map((v) => Math.fround(v)));
  });

  it('treats missing state cells as zero', () => {
    const out = selectiveScanStepCpu({
      state: [], pooled: Float32Array.from([1]), channels: 1, order: 2, decay: 0.9, gain: 1,
    });
    expect(Array.from(out)).toEqual([1, 1]);
  });
});

describe('selectiveScanStep dispatch', () => {
  const args = {
    state: [1, 1], pooled: Float32Array.from([1]), channels: 1, order: 2, decay: 0.5, gain: 0.5,
  };

  it('uses the CPU path when no GPU device is supplied', async () => {
    expect(Array.from(await selectiveScanStep(args))).toEqual([1, 1]);
    expect(Array.from(await selectiveScanStep(args, null))).toEqual([1, 1]);
  });

  it('falls back to the CPU path when the GPU path throws', async () => {
    const device = {
      createBuffer: vi.fn(() => {
        throw new Error('no gpu');
      }),
    } as unknown as GPUDevice;
    // GPUBufferUsage is undefined in node, so the GPU path throws -> CPU.
    expect(Array.from(await selectiveScanStep(args, device))).toEqual([1, 1]);
  });
});

describe('advanceState', () => {
  const base = emptyState({ dim: 4, order: 2, channels: 2 });

  it('defaults to decay 0.92 and gain 0.1 (historical behaviour)', async () => {
    expect(DEFAULT_SCAN_DECAY).toBe(0.92);
    const seeded = { ...base, data: [1, 1, 1, 1] };
    const next = await advanceState(seeded, Float32Array.from([2, 2, 4, 4]));
    // pooled = [2, 4]; c0: 0.92+0.2, c1: 0.92+0.4
    expect(next.data[0]).toBeCloseTo(1.12, 5);
    expect(next.data[2]).toBeCloseTo(1.32, 5);
    expect(next.step).toBe(1);
  });

  it('honours an explicit decay', async () => {
    const seeded = { ...base, data: [1, 1, 1, 1] };
    const next = await advanceState(seeded, Float32Array.from([0, 0, 0, 0]), { decay: 0.5 });
    expect(next.data).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

describe('WGSL source', () => {
  it('declares the four bindings and the update expression', () => {
    expect(SELECTIVE_SCAN_STEP_WGSL).toContain('@binding(3)');
    expect(SELECTIVE_SCAN_STEP_WGSL).toContain('params.decay * state[idx] + params.gain * pooled[c]');
  });
});
