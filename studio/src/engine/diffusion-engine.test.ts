import { describe, it, expect, vi } from 'vitest';

/**
 * Registry contract guard for two runtime ORT error families:
 *
 *   1. "input 'X' is missing in 'feeds'" — every name in a model's `unetInputs`
 *      must have a registered builder in UNET_INPUT_BUILDERS.
 *   2. "Unexpected input data type. Actual: (tensor(int64)), expected: (tensor(float))"
 *      — every input declares a dtype the engine can materialize, and the LCM
 *      `timestep` is float32 (not int64), the SD-Turbo `timestep` is int64.
 *
 * Both classes were observed at runtime and only catchable by an in-browser
 * session.run() before this contract was made explicit + testable.
 */

vi.mock('onnxruntime-web', () => ({
  env: { versions: { common: '0.0.0-test' }, wasm: {} },
  Tensor: class {
    constructor(public type: string, public data: unknown, public dims: number[]) {}
  },
  InferenceSession: { create: vi.fn() },
}));
vi.mock('@huggingface/transformers', () => ({
  env: { allowLocalModels: true, backends: { onnx: { wasm: {} } } },
  AutoTokenizer: { from_pretrained: vi.fn() },
}));

import {
  MODEL_REGISTRY,
  KNOWN_UNET_INPUTS,
  SUPPORTED_DTYPES,
  materializeTensor,
  buildOrtSessionOptions,
} from './diffusion-engine';

describe('MODEL_REGISTRY × UNet input contract', () => {
  for (const [id, descriptor] of Object.entries(MODEL_REGISTRY)) {
    it(`${id}: every declared UNet input has a registered builder`, () => {
      for (const spec of descriptor.unetInputs) {
        expect(
          KNOWN_UNET_INPUTS.has(spec.name),
          `Model '${id}' declares UNet input '${spec.name}' but UNET_INPUT_BUILDERS has no builder.`,
        ).toBe(true);
      }
    });

    it(`${id}: every declared dtype is supported by materializeTensor`, () => {
      for (const spec of [...descriptor.unetInputs, ...descriptor.textEncoderInputs]) {
        expect(
          SUPPORTED_DTYPES.has(spec.dtype),
          `Model '${id}' input '${spec.name}' declares unsupported dtype '${spec.dtype}'.`,
        ).toBe(true);
      }
    });
  }

  it("lcm-dreamshaper-v7 declares timestep_cond + lcmGuidanceEmbedDim (regression: missing-input feed)", () => {
    const lcm = MODEL_REGISTRY['lcm-dreamshaper-v7'];
    expect(lcm.unetInputs.map((s) => s.name)).toContain('timestep_cond');
    expect(lcm.lcmGuidanceEmbedDim).toBeGreaterThan(0);
  });

  it("lcm-dreamshaper-v7 timestep is float32 (regression: 'Unexpected input data type int64, expected float')", () => {
    const ts = MODEL_REGISTRY['lcm-dreamshaper-v7'].unetInputs.find((s) => s.name === 'timestep');
    expect(ts?.dtype).toBe('float32');
  });

  it('sd-turbo timestep is int64 (standard SD UNet export — flipping it would break SD-Turbo)', () => {
    const ts = MODEL_REGISTRY['sd-turbo'].unetInputs.find((s) => s.name === 'timestep');
    expect(ts?.dtype).toBe('int64');
  });

  it('sd-turbo does NOT declare timestep_cond (non-LCM UNet)', () => {
    const sdt = MODEL_REGISTRY['sd-turbo'];
    expect(sdt.unetInputs.map((s) => s.name)).not.toContain('timestep_cond');
    expect(sdt.lcmGuidanceEmbedDim).toBeUndefined();
  });

  it('every model declares the three base inputs sample / timestep / encoder_hidden_states', () => {
    for (const [id, descriptor] of Object.entries(MODEL_REGISTRY)) {
      const names = descriptor.unetInputs.map((s) => s.name);
      for (const required of ['sample', 'timestep', 'encoder_hidden_states']) {
        expect(names, `${id} missing required UNet input '${required}'`).toContain(required);
      }
    }
  });
});

describe('reportProgress (no-silent-phase invariant)', () => {
  // The regression this guards: the engine would set "Generating frames…" then
  // do minutes of model downloads + session creation + denoise without emitting
  // anything else, so the UI looked frozen. Every long phase must report.
  it('fans out to both console.info and the consumer callback', async () => {
    const { reportProgress } = await import('./diffusion-engine');
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const sink = vi.fn();
    reportProgress('hello', sink);
    expect(sink).toHaveBeenCalledWith('hello');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('hello'));
    consoleSpy.mockRestore();
  });

  it('handles a missing callback without throwing (console.info still fires)', async () => {
    const { reportProgress } = await import('./diffusion-engine');
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(() => reportProgress('no-sink', undefined)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('buildOrtSessionOptions (graph-fusion crash guard)', () => {
  // Regression: ORT-web's default graphOptimizationLevel 'all' runs extended
  // fusions (SimplifiedLayerNormFusion, InsertedPrecisionFreeCast folding)
  // that crash on browser-exported SD/SD-Turbo/LCM text-encoders. We MUST
  // pin to 'basic'. If a future refactor cranks it back up, this test fails.

  it("pins graphOptimizationLevel to 'basic' on every device path", () => {
    for (const device of ['webgpu', 'webnn', 'cpu'] as const) {
      const opts = buildOrtSessionOptions(device);
      expect(
        opts.graphOptimizationLevel,
        `device=${device} must use 'basic' to avoid the SimplifiedLayerNormFusion crash`,
      ).toBe('basic');
    }
  });

  it('picks the right executionProviders chain per device', () => {
    expect(buildOrtSessionOptions('webgpu').executionProviders).toEqual(['webgpu', 'wasm']);
    expect(buildOrtSessionOptions('webnn').executionProviders).toEqual(['webnn', 'wasm']);
    expect(buildOrtSessionOptions('cpu').executionProviders).toEqual(['wasm']);
  });
});

describe('materializeTensor produces a Tensor of the requested dtype', () => {
  const raw = { data: new Float32Array([1, 2, 3]), shape: [3] as const };

  it('float32 → Float32Array', () => {
    const t = materializeTensor('float32', raw);
    expect(t.type).toBe('float32');
    expect(t.data).toBeInstanceOf(Float32Array);
  });

  it('int64 → BigInt64Array (regression for the LCM timestep mis-dtype bug)', () => {
    const t = materializeTensor('int64', raw);
    expect(t.type).toBe('int64');
    expect(t.data).toBeInstanceOf(BigInt64Array);
  });

  it('int32 → Int32Array', () => {
    const t = materializeTensor('int32', raw);
    expect(t.type).toBe('int32');
    expect(t.data).toBeInstanceOf(Int32Array);
  });
});
