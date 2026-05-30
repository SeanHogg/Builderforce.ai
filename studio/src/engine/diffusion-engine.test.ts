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
  checkMemoryForModel,
  explainSessionCreateError,
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

  // Generalized contract: every LCM-family model (declares lcmGuidanceEmbedDim)
  // MUST also declare timestep_cond in unetInputs, and vice versa. One assertion
  // covers every current and future LCM model — no per-model maintenance.
  it("LCM/non-LCM consistency: lcmGuidanceEmbedDim ⇔ timestep_cond in unetInputs", () => {
    for (const [id, descriptor] of Object.entries(MODEL_REGISTRY)) {
      const isLcm = descriptor.lcmGuidanceEmbedDim !== undefined;
      const hasTimestepCond = descriptor.unetInputs.some((s) => s.name === 'timestep_cond');
      expect(
        isLcm,
        `'${id}' inconsistent: lcmGuidanceEmbedDim is ${isLcm ? 'set' : 'unset'} but timestep_cond is ${hasTimestepCond ? 'declared' : 'absent'}`,
      ).toBe(hasTimestepCond);
    }
  });

  // Per-model timestep dtype — known exports differ:
  //   LCM family (Dreamshaper, Tiny-SD)  → float32
  //   Standard SD UNets (SD-Turbo etc.)  → int64
  // Generalized: if it's an LCM family model, timestep must be float32.
  it("LCM-family timestep is float32 (regression: 'Unexpected input data type')", () => {
    for (const [id, descriptor] of Object.entries(MODEL_REGISTRY)) {
      if (descriptor.lcmGuidanceEmbedDim === undefined) continue;
      const ts = descriptor.unetInputs.find((s) => s.name === 'timestep');
      expect(ts?.dtype, `LCM model '${id}' must declare timestep as float32`).toBe('float32');
    }
  });

  it('sd-turbo timestep is int64 (standard SD UNet export — flipping it would break SD-Turbo)', () => {
    const ts = MODEL_REGISTRY['sd-turbo'].unetInputs.find((s) => s.name === 'timestep');
    expect(ts?.dtype).toBe('int64');
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

describe('checkMemoryForModel (pre-flight OOM guard)', () => {
  // Regression: without this, the engine attempts to load 1.7GB on a 4GB
  // device and ends with an opaque ORT `std::bad_alloc` (ERROR_CODE 6) after
  // multi-minute download. Fail fast with an actionable message instead.
  it('returns null when memory is sufficient', () => {
    expect(checkMemoryForModel(8 * 1024, 6 * 1024, 'lcm')).toBeNull();
    expect(checkMemoryForModel(6 * 1024, 6 * 1024, 'lcm')).toBeNull();
  });

  it('returns an actionable error string when memory is below the minimum', () => {
    const msg = checkMemoryForModel(4 * 1024, 6 * 1024, 'lcm-dreamshaper-v7');
    expect(msg).toContain('lcm-dreamshaper-v7');
    expect(msg).toContain('4.0 GB');
    expect(msg).toContain('6.0 GB');
    expect(msg).toMatch(/lighter model|Close other/);
  });

  it('returns null when device memory is unknown (allow attempt rather than block)', () => {
    expect(checkMemoryForModel(null, 6 * 1024, 'lcm')).toBeNull();
  });

  // Regression: prior version suggested "sd-turbo" even when sd-turbo WAS
  // the failing model — a self-contradicting recommendation.
  it('never suggests the failing model itself as a "lighter" alternative', () => {
    for (const id of Object.keys(MODEL_REGISTRY)) {
      const msg = checkMemoryForModel(1, 999_999, id);
      expect(msg, `'${id}' must not be recommended when it is the failing model`)
        .not.toMatch(new RegExp(`Try a lighter model.*\\b${id}\\b`));
    }
  });

  // Regression: prior version recommended ANY other registry entry, including
  // ones that are HEAVIER than (or equal to) the failing model and would OOM
  // identically. The hint must only name models that are strictly lighter AND
  // fit the reported memory — otherwise it's self-defeating advice.
  it('never recommends a model that is not strictly lighter than the failing one', () => {
    for (const failing of Object.values(MODEL_REGISTRY)) {
      const msg = checkMemoryForModel(1, failing.minVramMb, failing.id) ?? '';
      for (const other of Object.values(MODEL_REGISTRY)) {
        if (other.minVramMb >= failing.minVramMb) {
          expect(msg, `'${other.id}' (>= ${failing.id}'s VRAM) must not be recommended`)
            .not.toMatch(new RegExp(`Try a lighter model.*\\b${other.id}\\b`));
        }
      }
    }
  });

  it('never recommends a model that does not fit the reported available memory', () => {
    // 1 GB device, lcm-tiny-sd (the lightest registered, 2 GB) fails: nothing
    // in the registry is BOTH lighter than tiny-sd AND fits — so no model
    // may be named. (Scenario auto-updates as the registry grows: it just
    // exercises the "failing model is the lightest one" branch.)
    const lightest = Object.values(MODEL_REGISTRY).reduce((a, b) =>
      a.minVramMb <= b.minVramMb ? a : b,
    );
    const msg = checkMemoryForModel(lightest.minVramMb - 1024, lightest.minVramMb, lightest.id) ?? '';
    expect(msg).not.toMatch(/Try a lighter model/);
    expect(msg).toContain('No lighter model is available');
  });

  it('recommends the lighter model when it genuinely fits', () => {
    // Device fits sd-turbo (4 GB) but not lcm-dreamshaper-v7 (6 GB):
    // dreamshaper failing → recommendation includes at least sd-turbo.
    const msg = checkMemoryForModel(4 * 1024, MODEL_REGISTRY['lcm-dreamshaper-v7'].minVramMb, 'lcm-dreamshaper-v7') ?? '';
    expect(msg).toMatch(/Try a lighter model.*\bsd-turbo\b/);
  });
});

describe('explainSessionCreateError (opaque ORT crash → actionable message)', () => {
  it("rewraps a std::bad_alloc into a memory-shortage explanation", () => {
    const wrapped = explainSessionCreateError(
      new Error('Can\'t create a session. ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc'),
      'unet',
      'lcm-dreamshaper-v7',
      6 * 1024,
    );
    expect(wrapped.message).toContain('Out of memory');
    expect(wrapped.message).toContain('unet');
    expect(wrapped.message).toContain('lcm-dreamshaper-v7');
    expect(wrapped.message).toContain('6.0 GB');
  });

  it('rewraps a DXGI_ERROR_DEVICE_HUNG (Windows TDR) into a lower-resolution / lighter-model hint', () => {
    const wrapped = explainSessionCreateError(
      new Error('ID3D12Device::GetDeviceRemovedReason failed with DXGI_ERROR_DEVICE_HUNG (0x887A0006)'),
      'unet (conditional) session run',
      'lcm-tiny-sd',
      2 * 1024,
    );
    expect(wrapped.message).toContain('GPU device was lost');
    expect(wrapped.message).toContain('lcm-tiny-sd');
    expect(wrapped.message).toMatch(/lower resolution|lighter model|CPU/);
  });

  it("rewraps a 'Device is lost' mapAsync failure", () => {
    const wrapped = explainSessionCreateError(
      new Error("Failed to execute 'mapAsync' on 'GPUBuffer': [Device] is lost."),
      'unet session run',
      'lcm-dreamshaper-v7',
      6 * 1024,
    );
    expect(wrapped.message).toContain('GPU device was lost');
  });

  it('rewraps the SimplifiedLayerNormFusion crash into a graph-options hint', () => {
    const wrapped = explainSessionCreateError(
      new Error('graph_utils.cc:30 InsertedPrecisionFreeCast_/text_model/...'),
      'text_encoder',
      'sd-turbo',
      4 * 1024,
    );
    expect(wrapped.message).toContain('graph-fusion crash');
    expect(wrapped.message).toContain('buildOrtSessionOptions');
  });

  it('passes through unrelated errors unchanged', () => {
    const orig = new Error('totally different problem');
    expect(explainSessionCreateError(orig, 'unet', 'lcm', 6 * 1024)).toBe(orig);
  });

  // Same regression guard as checkMemoryForModel — the OOM message must not
  // tell the user to switch TO the model they're already running.
  it('never recommends the failing model itself in the OOM message', () => {
    for (const id of Object.keys(MODEL_REGISTRY)) {
      const wrapped = explainSessionCreateError(
        new Error('std::bad_alloc'),
        'unet',
        id,
        4 * 1024,
      );
      expect(wrapped.message, `'${id}' must not be recommended when it just OOM'd`)
        .not.toMatch(new RegExp(`Try a lighter model.*\\b${id}\\b`));
    }
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
