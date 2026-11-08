import "./chunk-3WOPFBU3.mjs";
import "./chunk-PAJI6YLR.mjs";

// node_modules/.pnpm/@webdit+runtime@file+..+web_9071895a3a20f5eafecc8e05e48e76a3/node_modules/@webdit/runtime/src/bundle.ts
async function buildMiniBundle(env) {
  const { MiniDitRunner, MiniTextEncoderRunner, MiniVaeRunner } = await import("./runners-mini-DGJBYJ4T.mjs");
  const { ditWeights, teWeights, vaeWeights } = await readAllShards(env);
  return {
    manifest: env.manifest,
    dit: new MiniDitRunner(ditWeights),
    textEncoder: new MiniTextEncoderRunner(teWeights, env.manifest),
    vae: new MiniVaeRunner(vaeWeights, env.manifest),
    tokenizer: await env.readTokenizer(),
    async unload() {
      ditWeights.clear();
      teWeights.clear();
      vaeWeights.clear();
    }
  };
}
async function buildTorchBundle(env) {
  const { buildTorchRunners } = await import("./runners-torch-SP7DDYM7.mjs");
  const { ditWeights, teWeights, vaeWeights } = await readAllShards(env);
  const parts = buildTorchRunners(env.manifest, ditWeights, teWeights, vaeWeights);
  return {
    manifest: env.manifest,
    dit: parts.dit,
    textEncoder: parts.textEncoder,
    vae: parts.vae,
    tokenizer: await env.readTokenizer(),
    async unload() {
      ditWeights.clear();
      teWeights.clear();
      vaeWeights.clear();
    }
  };
}
async function readAllShards(env) {
  const { parseBundleShard: parseBundleShard2 } = await import("./shard-loader-LZMBOS3M.mjs");
  const m = env.manifest;
  const read = env.readShard;
  const ditWeights = /* @__PURE__ */ new Map();
  for (const shard of m.files.ditWeightShards) {
    for (const [name, t] of parseBundleShard2(await read(shard))) {
      ditWeights.set(name, t);
    }
  }
  const teWeights = parseBundleShard2(await read(m.files.textEncoderWeights));
  const vaeWeights = parseBundleShard2(await read(m.files.vaeWeights));
  return { ditWeights, teWeights, vaeWeights };
}
async function loadBundleFromBuffers(manifest, files) {
  const readShard = async (rel) => {
    const buf = files[rel];
    if (!buf) {
      throw new Error(`loadBundleFromBuffers: missing file '${rel}' in supplied buffers`);
    }
    return new Uint8Array(buf);
  };
  if (manifest.backend === "mini") {
    return buildMiniBundle({ manifest, readShard, readTokenizer: () => loadMiniTokenizer() });
  }
  if (manifest.backend === "torch") {
    return buildTorchBundle({ manifest, readShard, readTokenizer: () => loadMiniTokenizer() });
  }
  return buildOrtBundleFromBuffers(manifest, files, readShard);
}
async function buildOrtBundleFromBuffers(manifest, files, readShard) {
  const ort = await import("onnxruntime-web/webgpu");
  const { OrtDitRunner, OrtTextEncoderRunner, OrtVaeRunner } = await import("./runners-ort-PHTNJDIR.mjs");
  const m = manifest;
  const externalDataFor = async (relPath) => {
    if (!relPath) return void 0;
    return [{ path: basename(relPath), data: await readShard(relPath) }];
  };
  const [ditSession, teSession, vaeSession, tokenizer] = await Promise.all([
    (async () => ort.InferenceSession.create(await readShard(m.files.ditGraph), {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
      externalData: await externalDataFor(m.files.ditGraphData)
    }))(),
    (async () => ort.InferenceSession.create(await readShard(m.files.textEncoderGraph), {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
      externalData: await externalDataFor(m.files.textEncoderGraphData)
    }))(),
    (async () => ort.InferenceSession.create(await readShard(m.files.vaeGraph), {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
      externalData: await externalDataFor(m.files.vaeGraphData)
    }))(),
    loadHfTokenizerFromBuffers(m.files.tokenizer, files)
  ]);
  const dit = new OrtDitRunner(ditSession);
  const textEncoder = new OrtTextEncoderRunner(teSession);
  const vae = new OrtVaeRunner(vaeSession);
  return {
    manifest: m,
    dit,
    textEncoder,
    vae,
    tokenizer,
    async unload() {
      await Promise.all([dit.release(), textEncoder.release(), vae.release()]);
    }
  };
}
async function loadHfTokenizerFromBuffers(tokenizerDir, files) {
  const dir = tokenizerDir.endsWith("/") ? tokenizerDir : `${tokenizerDir}/`;
  const decoder = new TextDecoder();
  const readJson = (name) => {
    const buf = files[`${dir}${name}`];
    if (!buf) {
      throw new Error(`loadBundleFromBuffers: missing tokenizer file '${dir}${name}'`);
    }
    return JSON.parse(decoder.decode(buf));
  };
  const { PreTrainedTokenizer } = await import("@huggingface/transformers");
  const tokenizerJSON = readJson("tokenizer.json");
  const tokenizerConfig = readJson("tokenizer_config.json");
  const tok = new PreTrainedTokenizer(tokenizerJSON, tokenizerConfig);
  return {
    encode(text, maxLength) {
      const out = tok(text, tokenizerCallOptions(maxLength));
      return {
        inputIds: extractTokenIds(out.input_ids, "input_ids"),
        attentionMask: extractTokenIds(out.attention_mask, "attention_mask")
      };
    }
  };
}
function tokenizerCallOptions(maxLength) {
  if (maxLength === void 0) return {};
  return { padding: "max_length", max_length: maxLength, truncation: true };
}
async function loadMiniTokenizer() {
  const DEFAULT_MAX = 8;
  return {
    encode(text, maxLength) {
      const MAX = maxLength ?? DEFAULT_MAX;
      const ids = new BigInt64Array(MAX);
      const mask = new BigInt64Array(MAX);
      for (let i = 0; i < MAX; i++) {
        const ch = text.charCodeAt(i % Math.max(1, text.length)) || 0;
        ids[i] = BigInt(ch & 63);
        mask[i] = i < text.length ? 1n : 0n;
      }
      return { inputIds: ids, attentionMask: mask };
    }
  };
}
function extractTokenIds(value, name) {
  const candidate = value?.data ?? value;
  if (candidate instanceof BigInt64Array) return candidate;
  if (candidate instanceof Int32Array || candidate instanceof Int16Array || candidate instanceof Uint32Array || candidate instanceof Uint16Array || Array.isArray(candidate)) {
    const arr = candidate;
    const out = new BigInt64Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = BigInt(Math.trunc(arr[i]));
    return out;
  }
  throw new Error(`Unsupported tokenizer output shape for ${name}`);
}
function basename(relPath) {
  const parts = relPath.split("/");
  return parts[parts.length - 1];
}

// node_modules/.pnpm/@webdit+runtime@file+..+web_9071895a3a20f5eafecc8e05e48e76a3/node_modules/@webdit/runtime/src/tensor-ops.ts
function latentFramesToPixelFrames(latentT, vaeCompression) {
  return vaeCompression.causal ? (latentT - 1) * vaeCompression.temporal + 1 : latentT * vaeCompression.temporal;
}
function applyClassifierFreeGuidance(uncond, cond, guidance) {
  assertSameLength(uncond, cond, "applyClassifierFreeGuidance");
  const out = new Float32Array(cond.data.length);
  for (let i = 0; i < out.length; i++) {
    const u = uncond.data[i];
    out[i] = u + guidance * (cond.data[i] - u);
  }
  return { data: out, dims: cond.dims };
}
function splitFrames(pixels, frames, width, height) {
  const planeSize = height * width;
  const expected = 3 * frames * planeSize;
  if (pixels.length !== expected) {
    throw new Error(
      `splitFrames: expected ${expected} elements (3\xD7${frames}\xD7${height}\xD7${width}), got ${pixels.length}`
    );
  }
  const channelStride = frames * planeSize;
  const out = [];
  for (let f = 0; f < frames; f++) {
    const frame = new Uint8ClampedArray(planeSize * 4);
    const tOffset = f * planeSize;
    for (let p = 0; p < planeSize; p++) {
      frame[p * 4 + 0] = unitToByte(pixels[0 * channelStride + tOffset + p]);
      frame[p * 4 + 1] = unitToByte(pixels[1 * channelStride + tOffset + p]);
      frame[p * 4 + 2] = unitToByte(pixels[2 * channelStride + tOffset + p]);
      frame[p * 4 + 3] = 255;
    }
    out.push(frame);
  }
  return out;
}
function makeNoiseLatent(manifest, frames, height, width, seed) {
  const latentT = Math.max(1, Math.ceil(frames / manifest.vaeCompression.temporal));
  const latentH = Math.max(1, Math.ceil(height / manifest.vaeCompression.spatial));
  const latentW = Math.max(1, Math.ceil(width / manifest.vaeCompression.spatial));
  const c = manifest.latentShape.c;
  const dims = [1, c, latentT, latentH, latentW];
  const total = c * latentT * latentH * latentW;
  const data = new Float32Array(total);
  const sample = seededGaussian(seed);
  for (let i = 0; i < total; i++) data[i] = sample();
  return { data, dims };
}
function assertSameLength(a, b, op) {
  if (a.data.length !== b.data.length) {
    throw new Error(
      `${op}: tensor length mismatch (${a.data.length} vs ${b.data.length})`
    );
  }
}
function unitToByte(v) {
  return Math.round((v + 1) * 127.5);
}
function seededGaussian(seed) {
  const uniform = seed === void 0 ? Math.random : mulberry32(seed);
  return () => {
    let u = uniform();
    while (u <= 0) u = uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform());
  };
}
function mulberry32(seed) {
  let state = seed >>> 0 || 305419896;
  return () => {
    state = state + 1831565813 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// node_modules/.pnpm/@webdit+runtime@file+..+web_9071895a3a20f5eafecc8e05e48e76a3/node_modules/@webdit/runtime/src/scheduler/ddim-vpred-zsnr.ts
var NUM_TRAIN_TIMESTEPS = 1e3;
var DdimVPredZsnrScheduler = class {
  alphasCumprod;
  finalAlphaCumprod = 1;
  // set_alpha_to_one=true
  timesteps;
  constructor(steps, opts = {}) {
    if (steps < 1) throw new Error(`DdimVPredZsnrScheduler: steps must be >= 1, got ${steps}`);
    const T = opts.numTrainTimesteps ?? NUM_TRAIN_TIMESTEPS;
    const betaStart = opts.betaStart ?? 85e-5;
    const betaEnd = opts.betaEnd ?? 0.012;
    const snrShiftScale = opts.snrShiftScale ?? 3;
    const alphasCumprod = computeAlphasCumprod(T, betaStart, betaEnd);
    rescaleZeroTerminalSnrInPlace(alphasCumprod);
    if (snrShiftScale !== 1) {
      for (let i = 0; i < T; i++) {
        const a = alphasCumprod[i];
        alphasCumprod[i] = a / (snrShiftScale + (1 - snrShiftScale) * a);
      }
    }
    this.alphasCumprod = alphasCumprod;
    const stepRatio = T / steps;
    const raw = [];
    for (let x = T; x > 0; x -= stepRatio) raw.push(Math.round(x) - 1);
    this.timesteps = raw.slice(0, steps).map((t) => Math.min(T - 1, Math.max(0, t)));
    if (this.timesteps.length !== steps) {
      throw new Error(
        `DdimVPredZsnrScheduler: expected ${steps} timesteps, computed ${this.timesteps.length}`
      );
    }
  }
  timestepAt(stepIdx) {
    return this.timesteps[stepIdx];
  }
  /** v-prediction DDIM step (eta=0, deterministic), `clip_sample=false`. */
  step(latent, prediction, stepIdx) {
    assertSameLength(latent, prediction, "DdimVPredZsnrScheduler.step");
    const t = this.timesteps[stepIdx];
    const tPrevIdx = stepIdx + 1;
    const tPrev = tPrevIdx < this.timesteps.length ? this.timesteps[tPrevIdx] : -1;
    const alphaProdT = this.alphasCumprod[t];
    const alphaProdTPrev = tPrev >= 0 ? this.alphasCumprod[tPrev] : this.finalAlphaCumprod;
    const betaProdT = 1 - alphaProdT;
    const sqrtAlphaT = Math.sqrt(alphaProdT);
    const sqrtBetaT = Math.sqrt(betaProdT);
    const sqrtAlphaTPrev = Math.sqrt(alphaProdTPrev);
    const sqrtBetaTPrev = Math.sqrt(1 - alphaProdTPrev);
    const x = latent.data;
    const v = prediction.data;
    for (let i = 0; i < x.length; i++) {
      const sample = x[i];
      const velocity = v[i];
      const predOriginalSample = sqrtAlphaT * sample - sqrtBetaT * velocity;
      const predEpsilon = sqrtAlphaT * velocity + sqrtBetaT * sample;
      const predSampleDirection = sqrtBetaTPrev * predEpsilon;
      x[i] = sqrtAlphaTPrev * predOriginalSample + predSampleDirection;
    }
  }
};
function computeAlphasCumprod(T, betaStart, betaEnd) {
  const bStartSqrt = Math.sqrt(betaStart);
  const bEndSqrt = Math.sqrt(betaEnd);
  const alphasCumprod = new Float64Array(T);
  let acc = 1;
  for (let i = 0; i < T; i++) {
    const bSqrt = bStartSqrt + (bEndSqrt - bStartSqrt) * i / (T - 1);
    const beta = bSqrt * bSqrt;
    acc *= 1 - beta;
    alphasCumprod[i] = acc;
  }
  return alphasCumprod;
}
function rescaleZeroTerminalSnrInPlace(alphasCumprod) {
  const n = alphasCumprod.length;
  const sqrtAlphasCumprod = new Float64Array(n);
  for (let i = 0; i < n; i++) sqrtAlphasCumprod[i] = Math.sqrt(alphasCumprod[i]);
  const sqrt0 = sqrtAlphasCumprod[0];
  const sqrtT = sqrtAlphasCumprod[n - 1];
  const denom = sqrt0 - sqrtT;
  for (let i = 0; i < n; i++) {
    let v = sqrtAlphasCumprod[i] - sqrtT;
    v *= sqrt0 / denom;
    alphasCumprod[i] = v * v;
  }
}

// node_modules/.pnpm/@webdit+runtime@file+..+web_9071895a3a20f5eafecc8e05e48e76a3/node_modules/@webdit/runtime/src/scheduler/euler.ts
var EulerScheduler = class {
  sigmas;
  constructor(steps, sigmaMin = 2e-3, sigmaMax = 14.61, rho = 7) {
    if (steps < 1) throw new Error(`EulerScheduler: steps must be >= 1, got ${steps}`);
    this.sigmas = new Float32Array(steps + 1);
    const a = Math.pow(sigmaMax, 1 / rho);
    const b = Math.pow(sigmaMin, 1 / rho);
    for (let i = 0; i < steps; i++) {
      const t = i / Math.max(1, steps - 1);
      this.sigmas[i] = Math.pow(a + t * (b - a), rho);
    }
    this.sigmas[steps] = 0;
  }
  timestepAt(stepIdx) {
    return this.sigmas[stepIdx];
  }
  step(latent, prediction, stepIdx) {
    assertSameLength(latent, prediction, "EulerScheduler.step");
    const sigma = this.sigmas[stepIdx];
    const sigmaNext = this.sigmas[stepIdx + 1];
    if (sigma === 0) return;
    const k = (sigmaNext - sigma) / sigma;
    const x = latent.data;
    const eps = prediction.data;
    for (let i = 0; i < x.length; i++) x[i] = x[i] + k * eps[i];
  }
};

// node_modules/.pnpm/@webdit+runtime@file+..+web_9071895a3a20f5eafecc8e05e48e76a3/node_modules/@webdit/runtime/src/scheduler/flow-match.ts
var FlowMatchScheduler = class {
  sigmas;
  constructor(steps) {
    this.sigmas = new Float32Array(steps + 1);
    for (let i = 0; i <= steps; i++) {
      this.sigmas[i] = 1 - i / steps;
    }
  }
  timestepAt(stepIdx) {
    return this.sigmas[stepIdx];
  }
  step(latent, prediction, stepIdx) {
    assertSameLength(latent, prediction, "FlowMatchScheduler.step");
    const dt = this.sigmas[stepIdx] - this.sigmas[stepIdx + 1];
    const x = latent.data;
    const v = prediction.data;
    for (let i = 0; i < x.length; i++) x[i] = x[i] - dt * v[i];
  }
};

// node_modules/.pnpm/@webdit+runtime@file+..+web_9071895a3a20f5eafecc8e05e48e76a3/node_modules/@webdit/runtime/src/scheduler/index.ts
function makeScheduler(kind, steps) {
  switch (kind) {
    case "flow-match-rect":
      return new FlowMatchScheduler(steps);
    case "euler":
      return new EulerScheduler(steps);
    case "ddim-vpred-zsnr":
      return new DdimVPredZsnrScheduler(steps);
    case "dpm++-2m":
      throw new Error(`Scheduler '${kind}' not yet implemented`);
  }
}

// node_modules/.pnpm/@webdit+runtime@file+..+web_9071895a3a20f5eafecc8e05e48e76a3/node_modules/@webdit/runtime/src/ort-runner.ts
async function runDenoiseLoop(bundle, req) {
  const t0 = performance.now();
  const m = bundle.manifest;
  const steps = req.steps ?? m.defaults.steps;
  const frames = req.frames ?? m.defaults.frames;
  const height = req.height ?? m.defaults.height;
  const width = req.width ?? m.defaults.width;
  const guidance = req.guidanceScale ?? m.defaults.guidanceScale;
  const cond = await encodeText(bundle, req.prompt);
  const uncond = await encodeText(bundle, req.negativePrompt ?? "");
  const latent = makeNoiseLatent(m, frames, height, width, req.seed);
  const scheduler = makeScheduler(m.scheduler, steps);
  for (let i = 0; i < steps; i++) {
    const t = scheduler.timestepAt(i);
    const eCond = await bundle.dit.run(latent, t, cond);
    const eUncond = await bundle.dit.run(latent, t, uncond);
    const guided = applyClassifierFreeGuidance(eUncond, eCond, guidance);
    scheduler.step(latent, guided, i);
    req.onProgress?.(i + 1, steps);
  }
  const pixels = await bundle.vae.run(latent);
  const latentT = latent.dims[2];
  const latentH = latent.dims[3];
  const latentW = latent.dims[4];
  const outFrames = latentFramesToPixelFrames(latentT, m.vaeCompression);
  const outHeight = latentH * m.vaeCompression.spatial;
  const outWidth = latentW * m.vaeCompression.spatial;
  return {
    frames: splitFrames(pixels, outFrames, outWidth, outHeight),
    width: outWidth,
    height: outHeight,
    elapsedMs: performance.now() - t0
  };
}
async function encodeText(bundle, prompt) {
  const { inputIds, attentionMask } = bundle.tokenizer.encode(
    prompt,
    bundle.manifest.textEncoder.maxTokens
  );
  return bundle.textEncoder.run(inputIds, attentionMask);
}
export {
  loadBundleFromBuffers,
  runDenoiseLoop
};
//# sourceMappingURL=webdit-runtime-WXCXDBYI.mjs.map