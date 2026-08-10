import { describe, expect, it, vi } from 'vitest';
import { MambaEngine } from './mamba-engine';

describe('MambaEngine lifecycle', () => {
  it('releases every owned WebGPU resource exactly once', () => {
    const engine = new MambaEngine('agent-1', 'project-1');
    const destroyers = Array.from({ length: 7 }, () => vi.fn());
    const [params, state, input, stateOut, output, readback, device] = destroyers;

    const internals = engine as unknown as {
      gpuBackend: unknown;
      gpuReady: boolean;
    };
    internals.gpuBackend = {
      paramsBuffer: { destroy: params },
      stateBuffer: { destroy: state },
      inputBuffer: { destroy: input },
      stateOutBuffer: { destroy: stateOut },
      outputBuffer: { destroy: output },
      readbackBuffer: { destroy: readback },
      device: { destroy: device },
    };
    internals.gpuReady = true;

    engine.dispose();
    engine.dispose();

    expect(destroyers.every((destroy) => destroy.mock.calls.length === 1)).toBe(true);
    expect(internals.gpuBackend).toBeNull();
    expect(internals.gpuReady).toBe(false);
  });
});
