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
vi.mock('./weight-cache', () => ({
  getOrFetchWeight: vi.fn(async () => new ArrayBuffer(16)),
}));

import {
  MODEL_REGISTRY,
  KNOWN_UNET_INPUTS,
  SUPPORTED_DTYPES,
  materializeTensor,
  buildOrtSessionOptions,
  checkMemoryForModel,
  explainSessionCreateError,
  DiffusionEngine,
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

  it("suppresses ORT warnings (logSeverityLevel: 3) — they're informational and spam the console per session", () => {
    for (const device of ['webgpu', 'webnn', 'cpu'] as const) {
      expect(buildOrtSessionOptions(device).logSeverityLevel).toBe(3);
    }
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

describe('DiffusionEngine.dispose (memory-leak guard)', () => {
  // The bug this guards: ORT sessions hold multi-GB WASM heaps + WebGPU buffers
  // that don't get GC'd when the React tree unmounts. dispose() MUST call
  // release() on every session AND destroy() on the GPUDevice — otherwise
  // switching IDE modality leaves the studio holding 1.7+ GB indefinitely.
  function makeEngine() {
    const release = vi.fn(async () => {});
    const destroy = vi.fn();
    const engine = new DiffusionEngine({
      model: 'sd-turbo',
      probed: {
        kind: 'webgpu',
        label: 'mock',
        approxMemoryMb: null,
        gpuDevice: { destroy } as unknown as GPUDevice,
      },
      apiKey: '',
      weightSources: ['huggingface-cdn'],
      width: 512,
      height: 512,
    });
    const fakeSession = { release } as unknown as Parameters<typeof Promise.resolve>[0];
    // Inject mock sessions directly (init() does heavy real work we don't need here).
    (engine as unknown as Record<string, unknown>).textEncoderSession = fakeSession;
    (engine as unknown as Record<string, unknown>).unetSession = fakeSession;
    (engine as unknown as Record<string, unknown>).vaeSession = fakeSession;
    return { engine, release, destroy };
  }

  it('releases every ORT session and destroys the GPUDevice', async () => {
    const { engine, release, destroy } = makeEngine();
    await engine.dispose();
    expect(release).toHaveBeenCalledTimes(3); // text_encoder + unet + vae
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — calling dispose twice does not double-release', async () => {
    const { engine, release, destroy } = makeEngine();
    await engine.dispose();
    await engine.dispose();
    expect(release).toHaveBeenCalledTimes(3);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('nulls the session refs so accidental reuse is a clear error, not a stale call', async () => {
    const { engine } = makeEngine();
    await engine.dispose();
    const inner = engine as unknown as Record<string, unknown>;
    expect(inner.textEncoderSession).toBeNull();
    expect(inner.unetSession).toBeNull();
    expect(inner.vaeSession).toBeNull();
  });

  it('swallows release() errors so one bad session does not prevent the others from releasing', async () => {
    const goodRelease = vi.fn(async () => {});
    const badRelease = vi.fn(async () => { throw new Error('release threw'); });
    const destroy = vi.fn();
    const engine = new DiffusionEngine({
      model: 'sd-turbo',
      probed: { kind: 'webgpu', label: 'mock', approxMemoryMb: null, gpuDevice: { destroy } as unknown as GPUDevice },
      apiKey: '',
      weightSources: ['huggingface-cdn'],
      width: 512,
      height: 512,
    });
    (engine as unknown as Record<string, unknown>).textEncoderSession = { release: goodRelease };
    (engine as unknown as Record<string, unknown>).unetSession = { release: badRelease };
    (engine as unknown as Record<string, unknown>).vaeSession = { release: goodRelease };
    await expect(engine.dispose()).resolves.toBeUndefined();
    expect(goodRelease).toHaveBeenCalledTimes(2);
    expect(badRelease).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('DiffusionEngine.init session-create serialisation (external-data race guard)', () => {
  // The bug this guards: ORT-web mounts external-data sidecars on a GLOBAL Map
  // (`f.Xc`) on the wasm Module, and the `finally` block of every session
  // create calls `unmountExternalData()` which wipes that map. Three concurrent
  // `Promise.all` creates with sidecars therefore race: the first session's
  // finally wipes the data the second is still mid-deserialize. Symptom is
  //   "Failed to load external data file 'model.onnx_data',
  //    error: Module.MountedFiles is not available."
  // The fix is to download all weights in parallel but create ORT sessions
  // SERIALLY. This test locks that invariant by detecting any temporal overlap
  // between InferenceSession.create invocations during init().
  it('runs InferenceSession.create calls sequentially (no overlap)', async () => {
    const ort = await import('onnxruntime-web');
    const transformers = await import('@huggingface/transformers');

    // Stub the tokenizer so init() doesn't reach the network.
    (transformers.AutoTokenizer.from_pretrained as ReturnType<typeof vi.fn>).mockResolvedValue(
      Object.assign(async () => ({ input_ids: { data: new BigInt64Array(77) } }), {})
    );

    // Track create overlaps. Each call increments `inFlight`; if it ever
    // exceeds 1, two creates overlapped → the global mountedFiles Map would
    // race in real ORT-web.
    let inFlight = 0;
    let maxInFlight = 0;
    const createMock = ort.InferenceSession.create as ReturnType<typeof vi.fn>;
    createMock.mockReset();
    createMock.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield to the microtask queue so a buggy `Promise.all` actually does
      // overlap (without the await, every call would complete synchronously
      // and the in-flight counter would never exceed 1 even when racing).
      await new Promise<void>((r) => setTimeout(r, 5));
      inFlight--;
      // Minimal session-shape stub for assertSessionMatchesSpec.
      return {
        inputNames: ['sample', 'timestep', 'encoder_hidden_states', 'input_ids', 'timestep_cond'],
        release: async () => {},
      } as unknown as Awaited<ReturnType<typeof ort.InferenceSession.create>>;
    });

    const engine = new DiffusionEngine({
      // Pick lcm-dreamshaper-v7 — both unet and vae_decoder have external-data
      // sidecars, so a buggy parallel implementation would race.
      model: 'lcm-dreamshaper-v7',
      probed: { kind: 'wasm', label: 'mock', approxMemoryMb: null },
      apiKey: '',
      weightSources: ['huggingface-cdn'],
      width: 512,
      height: 512,
    });

    await engine.init();

    expect(createMock).toHaveBeenCalledTimes(3); // text_encoder + unet + vae
    expect(
      maxInFlight,
      `InferenceSession.create overlapped (max in-flight ${maxInFlight}). ` +
        `ORT-web's external-data Map is global — concurrent creates corrupt each other. ` +
        `Keep the per-session create sequential in DiffusionEngine.init().`,
    ).toBe(1);
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
