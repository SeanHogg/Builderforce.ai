"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  CAMERA_MOVES: () => CAMERA_MOVES,
  MODEL_REGISTRY: () => MODEL_REGISTRY,
  NeuralCodec: () => NeuralCodec,
  SSMAcousticModel: () => SSMAcousticModel,
  SSMVoiceProvider: () => SSMVoiceProvider,
  TEXT_VOCAB_SIZE: () => TEXT_VOCAB_SIZE,
  VideoEngine: () => VideoEngine,
  VoiceCloneEngine: () => VoiceCloneEngine,
  buildInterpolatedSequence: () => buildInterpolatedSequence,
  cameraMoveToMotion: () => cameraMoveToMotion,
  composeShotPrompt: () => composeShotPrompt,
  configureOnnxRuntime: () => configureOnnxRuntime,
  cosineSimilarity: () => cosineSimilarity,
  directorPass: () => directorPass,
  encodeSpeaker: () => encodeSpeaker,
  encodeWav: () => encodeWav,
  encodeWavBlob: () => encodeWavBlob,
  estimateBlockMotion: () => estimateBlockMotion,
  hasWebGPUSupport: () => hasWebGPUSupport,
  interpolateFrames: () => interpolateFrames,
  luma: () => luma,
  melSpectrogram: () => melSpectrogram,
  melToWaveform: () => melToWaveform,
  normaliseShotBudget: () => normaliseShotBudget,
  planKeyframeIndices: () => planKeyframeIndices,
  planScene: () => planScene,
  probeDevice: () => probeDevice,
  resolveVoiceProvider: () => resolveVoiceProvider,
  shotPlannerPass: () => shotPlannerPass,
  slerp: () => slerp,
  storyboardFrameCount: () => storyboardFrameCount,
  tokenizeText: () => tokenizeText,
  validateFrame: () => validateFrame,
  verifySpeaker: () => verifySpeaker
});
module.exports = __toCommonJS(src_exports);

// src/engine/device-router.ts
function hasWebGPUSupport() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}
async function probeDevice(target = "auto") {
  const order = target === "auto" ? ["webnn", "webgpu", "cpu"] : target === "cpu" ? ["cpu"] : target === "webgpu" ? ["webgpu"] : ["webnn"];
  for (const candidate of order) {
    const probed = await probeOne(candidate);
    if (probed) return probed;
  }
  return null;
}
async function probeOne(kind) {
  if (kind === "webnn") return probeWebNN();
  if (kind === "webgpu") return probeWebGPU();
  return probeCpu();
}
async function probeWebNN() {
  if (typeof navigator === "undefined") return null;
  const nav = navigator;
  if (!nav.ml || typeof nav.ml.createContext !== "function") return null;
  for (const deviceType of ["npu", "gpu"]) {
    try {
      const ctx = await nav.ml.createContext({ deviceType, powerPreference: "high-performance" });
      if (ctx) {
        return {
          kind: "webnn",
          mlContext: ctx,
          label: `WebNN (${deviceType.toUpperCase()})`,
          approxMemoryMb: null
        };
      }
    } catch {
    }
  }
  return null;
}
async function probeWebGPU() {
  if (!hasWebGPUSupport()) return null;
  const nav = navigator;
  if (!nav.gpu) return null;
  try {
    const adapter = await nav.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: Math.min(adapter.limits.maxBufferSize, 2147483648),
        maxStorageBufferBindingSize: Math.min(
          adapter.limits.maxStorageBufferBindingSize,
          2147483648
        )
      }
    });
    const info = adapter.info;
    const label = [info?.vendor, info?.architecture, info?.device].filter(Boolean).join(" ") || "WebGPU device";
    return { kind: "webgpu", gpuDevice: device, label, approxMemoryMb: null };
  } catch {
    return null;
  }
}
function probeCpu() {
  return {
    kind: "cpu",
    label: "CPU (WASM SIMD)",
    approxMemoryMb: null
  };
}

// src/engine/diffusion-engine.ts
var ort2 = __toESM(require("onnxruntime-web"), 1);
var import_transformers2 = require("@huggingface/transformers");

// src/engine/weight-cache.ts
var DB_NAME = "builderforce-studio-weights";
var DB_VERSION = 1;
var STORE_NAME = "weights";
var DEFAULT_R2_BASE = "https://api.builderforce.ai/api/studio/weights";
var HF_BASE = "https://huggingface.co";
async function getOrFetchWeight(opts) {
  const cached = await readFromIdb(opts.cacheKey);
  if (cached) {
    opts.onProgress?.(cached.byteLength, cached.byteLength);
    return cached;
  }
  const buffer = await fetchFromAnySource(opts);
  await writeToIdb(opts.cacheKey, buffer).catch(() => {
  });
  return buffer;
}
async function fetchFromAnySource(opts) {
  const errors = [];
  for (const source of opts.sources) {
    try {
      return await fetchFromSource(source, opts);
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }
  const detail = errors.map((e) => e.message).join(" | ");
  throw new Error(`All weight sources failed for ${opts.cacheKey}: ${detail}`);
}
async function fetchFromSource(source, opts) {
  const { url, headers } = resolveSource(source, opts);
  const res = await fetch(url, { headers, signal: opts.signal });
  if (!res.ok || !res.body) {
    throw new Error(`${source} ${url} \u2192 HTTP ${res.status}`);
  }
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : null;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    opts.onProgress?.(received, total);
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buf.buffer;
}
function resolveSource(source, opts) {
  if (source === "r2-proxy") {
    const base = opts.r2Base ?? DEFAULT_R2_BASE;
    return {
      url: `${base}/${opts.cacheKey}`,
      headers: { Authorization: `Bearer ${opts.apiKey}` }
    };
  }
  return {
    url: `${HF_BASE}/${opts.hfRepo}/resolve/main/${opts.hfPath}`,
    headers: {}
  };
}
async function openDb() {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
async function readFromIdb(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}
async function writeToIdb(key, value) {
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB write failed"));
  });
}

// src/engine/onnx-runtime-config.ts
var ort = __toESM(require("onnxruntime-web"), 1);
var import_transformers = require("@huggingface/transformers");
function versionMatchedCdn() {
  const version = ort.env?.versions?.common;
  return version ? `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/` : "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
}
var configured = false;
function configureOnnxRuntime(opts = {}) {
  if (configured) return;
  configured = true;
  const wasmCdn = opts.wasmCdn ?? versionMatchedCdn();
  const numThreads = opts.numThreads ?? 1;
  import_transformers.env.allowLocalModels = false;
  if (import_transformers.env.backends?.onnx?.wasm) {
    import_transformers.env.backends.onnx.wasm.numThreads = numThreads;
    import_transformers.env.backends.onnx.wasm.wasmPaths = wasmCdn;
  }
  ort.env.wasm.wasmPaths = wasmCdn;
  ort.env.wasm.numThreads = numThreads;
}

// src/engine/diffusion-engine.ts
configureOnnxRuntime();
var MODEL_REGISTRY = {
  "lcm-tiny-sd": {
    id: "lcm-tiny-sd",
    defaultSteps: 4,
    defaultGuidance: 1,
    minVramMb: 2 * 1024,
    // BK-SDM Tiny UNet (~0.3 GB fp16) + text-encoder + VAE
    hfRepo: "akameswa/lcm-tiny-sd-onnx-fp16",
    tokenizerRepo: "Xenova/clip-vit-large-patch14",
    textEmbedDim: 768,
    // SD1.5 base
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999, 759, 519, 259],
    files: {
      textEncoder: { model: "text_encoder/model.onnx" },
      unet: { model: "unet/model.onnx", externalData: "unet/model.onnx_data" },
      vaeDecoder: { model: "vae_decoder/model.onnx", externalData: "vae_decoder/model.onnx_data" }
    },
    // The akameswa export omits the LCM `timestep_cond` input (the "LCM" aspect
    // here is just the 4-step scheduler, not the consistency-embedding), but
    // it DOES keep the LCM-family float32 timestep — declaring int64 here
    // surfaces at first denoise as "Unexpected input data type. Actual:
    // (tensor(int64)), expected: (tensor(float))". The lcmFamilyTimestepIsFloat32
    // test in diffusion-engine.test.ts locks both LCM-family models on float32.
    unetInputs: [
      { name: "sample", dtype: "float32" },
      { name: "timestep", dtype: "float32" },
      { name: "encoder_hidden_states", dtype: "float32" }
    ],
    textEncoderInputs: [{ name: "input_ids", dtype: "int32" }]
    // lcmGuidanceEmbedDim intentionally omitted — see the unetInputs comment.
  },
  "lcm-dreamshaper-v7": {
    id: "lcm-dreamshaper-v7",
    defaultSteps: 4,
    defaultGuidance: 1,
    // LCM works best with CFG ~1
    minVramMb: 6 * 1024,
    hfRepo: "aislamov/lcm-dreamshaper-v7-onnx",
    tokenizerRepo: "Xenova/clip-vit-large-patch14",
    textEmbedDim: 768,
    // SD1.5 base
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999, 759, 519, 259],
    files: {
      textEncoder: { model: "text_encoder/model.onnx" },
      unet: { model: "unet/model.onnx", externalData: "unet/model.onnx_data" },
      vaeDecoder: { model: "vae_decoder/model.onnx", externalData: "vae_decoder/model.onnx_data" }
    },
    // LCM Dreamshaper (aislamov) UNet expects timestep as float32 (NOT int64).
    // Drift here surfaces as: "Unexpected input data type. Actual: int64, expected: float".
    unetInputs: [
      { name: "sample", dtype: "float32" },
      { name: "timestep", dtype: "float32" },
      { name: "encoder_hidden_states", dtype: "float32" },
      { name: "timestep_cond", dtype: "float32" }
    ],
    textEncoderInputs: [{ name: "input_ids", dtype: "int32" }],
    lcmGuidanceEmbedDim: 256,
    // standard for LCM-LoRA-derived exports
    lcmGuidanceScale: 8.5
    // diffusers LCM default — embedded into timestep_cond (NOT defaultGuidance)
  },
  "sd-turbo": {
    id: "sd-turbo",
    defaultSteps: 1,
    defaultGuidance: 0,
    // SD-Turbo is unconditional
    minVramMb: 4 * 1024,
    hfRepo: "schmuell/sd-turbo-ort-web",
    // ORT-team browser demo build (single-file ONNX)
    tokenizerRepo: "Xenova/clip-vit-large-patch14",
    textEmbedDim: 1024,
    // SD2.1 base
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999],
    files: {
      textEncoder: { model: "text_encoder/model.onnx" },
      unet: { model: "unet/model.onnx" },
      vaeDecoder: { model: "vae_decoder/model.onnx" }
    },
    // schmuell/sd-turbo-ort-web export uses int64 timestep (standard SD UNet).
    unetInputs: [
      { name: "sample", dtype: "float32" },
      { name: "timestep", dtype: "int64" },
      { name: "encoder_hidden_states", dtype: "float32" }
    ],
    textEncoderInputs: [{ name: "input_ids", dtype: "int32" }]
  }
};
var UNET_INPUT_BUILDERS = {
  sample: (ctx) => ({ data: ctx.sample, shape: ctx.latentShape }),
  timestep: (ctx) => ({ data: Float32Array.from([ctx.timestep]), shape: [1] }),
  encoder_hidden_states: (ctx) => ({
    data: ctx.condEmbedding,
    shape: [1, ctx.descriptor.sequenceLength, ctx.descriptor.textEmbedDim]
  }),
  timestep_cond: (ctx) => ({
    // LCM consistency-model guidance-scale embedding. The embedded scale is the
    // model's DISTILLATION guidance scale (descriptor.lcmGuidanceScale, diffusers
    // default 8.5), NOT the runtime cond/uncond mix `ctx.guidance` (~1 for LCM).
    // Embedding the mix scale gave w = 1 - 1 = 0 → a degenerate all-[sin0=0,cos0=1]
    // vector, conditioning the UNet as if guidance≈1 and producing washed,
    // out-of-range latents on the refinement pass. See lcmGuidanceCondEmbedding.
    data: lcmGuidanceCondEmbedding(ctx.descriptor),
    shape: [1, ctx.descriptor.lcmGuidanceEmbedDim ?? 256]
  })
};
var KNOWN_UNET_INPUTS = new Set(
  Object.keys(UNET_INPUT_BUILDERS)
);
function materializeTensor(dtype, raw) {
  const shape = [...raw.shape];
  if (dtype === "float32") {
    return new ort2.Tensor("float32", raw.data, shape);
  }
  if (dtype === "int32") {
    const out = new Int32Array(raw.data.length);
    for (let i = 0; i < raw.data.length; i++) out[i] = raw.data[i] | 0;
    return new ort2.Tensor("int32", out, shape);
  }
  if (dtype === "int64") {
    const out = new BigInt64Array(raw.data.length);
    for (let i = 0; i < raw.data.length; i++) out[i] = BigInt(raw.data[i] | 0);
    return new ort2.Tensor("int64", out, shape);
  }
  throw new Error(`Unsupported dtype: ${dtype}`);
}
var DEFAULT_LCM_GUIDANCE_SCALE = 8.5;
function lcmGuidanceCondEmbedding(descriptor) {
  const dim = descriptor.lcmGuidanceEmbedDim ?? 256;
  const w = (descriptor.lcmGuidanceScale ?? DEFAULT_LCM_GUIDANCE_SCALE) - 1;
  return guidanceScaleEmbedding(w, dim);
}
function guidanceScaleEmbedding(w, dim) {
  const half = Math.floor(dim / 2);
  const out = new Float32Array(dim);
  const logBase = Math.log(1e4) / Math.max(1, half - 1);
  const wScaled = w * 1e3;
  for (let i = 0; i < half; i++) {
    const freq = Math.exp(-logBase * i);
    out[i] = Math.sin(wScaled * freq);
    if (half + i < dim) out[half + i] = Math.cos(wScaled * freq);
  }
  return out;
}
var ALPHAS_CUMPROD = computeAlphasCumprod(85e-5, 0.012, 1e3);
function computeAlphasCumprod(betaStart, betaEnd, T) {
  const out = new Float32Array(T);
  const sqrtStart = Math.sqrt(betaStart);
  const sqrtEnd = Math.sqrt(betaEnd);
  let running = 1;
  for (let t = 0; t < T; t++) {
    const sqrtBeta = sqrtStart + (sqrtEnd - sqrtStart) * (t / (T - 1));
    const beta = sqrtBeta * sqrtBeta;
    running *= 1 - beta;
    out[t] = running;
  }
  return out;
}
function reportProgress(label, onProgress) {
  console.info(`[builderforce-studio] ${label}`);
  onProgress?.(label);
}
var DiffusionEngine = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  tokenizer = null;
  textEncoderSession = null;
  unetSession = null;
  vaeSession = null;
  disposed = false;
  // -------------------------------------------------------------------------
  async init() {
    const d = this.descriptor;
    const sessionOptions = this.buildSessionOptions();
    const onProgress = this.opts.onProgress;
    const memoryError = checkMemoryForModel(
      this.opts.probed.approxMemoryMb,
      d.minVramMb,
      d.id
    );
    if (memoryError) {
      throw new Error(memoryError);
    }
    if (this.opts.probed.kind === "webgpu" && this.opts.probed.gpuDevice) {
      this.opts.probed.gpuDevice.lost.then((info) => {
        reportProgress(
          `GPU device LOST (${info.reason}): ${info.message}. Reload the page; pick a lower resolution or lighter model on retry.`,
          onProgress
        );
      }).catch(() => {
      });
    }
    reportProgress(`Loading CLIP tokenizer (${d.tokenizerRepo})\u2026`, onProgress);
    this.tokenizer = await import_transformers2.AutoTokenizer.from_pretrained(d.tokenizerRepo);
    reportProgress("Tokenizer ready.", onProgress);
    reportProgress(`Loading ${d.id} weights (UNet + text-encoder + VAE)\u2026`, onProgress);
    const downloads = await Promise.all([
      this.fetchSessionBuffers(d.files.textEncoder, "text_encoder"),
      this.fetchSessionBuffers(d.files.unet, "unet"),
      this.fetchSessionBuffers(d.files.vaeDecoder, "vae_decoder")
    ]);
    this.textEncoderSession = await this.createSessionFromBuffers(downloads[0], sessionOptions);
    this.unetSession = await this.createSessionFromBuffers(downloads[1], sessionOptions);
    this.vaeSession = await this.createSessionFromBuffers(downloads[2], sessionOptions);
    reportProgress("All ORT sessions created.", onProgress);
    assertSessionMatchesSpec("unet", this.unetSession, d.unetInputs);
    assertSessionMatchesSpec("text_encoder", this.textEncoderSession, d.textEncoderInputs);
    reportProgress("Model graph contract verified \u2014 engine ready.", onProgress);
  }
  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------
  /**
   * Release ORT sessions + destroy the engine's GPU device. Idempotent and
   * safe to await even on a never-fully-init'd engine. After dispose() the
   * engine cannot be reused — create a new one.
   *
   * ORT sessions hold large WASM heaps + WebGPU buffers (the LCM UNet
   * alone is ~1.7 GB). Without release(), those stay allocated even after
   * the React tree unmounts — exactly the leak the user surfaced.
   */
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const sessions = [this.textEncoderSession, this.unetSession, this.vaeSession];
    this.textEncoderSession = null;
    this.unetSession = null;
    this.vaeSession = null;
    this.tokenizer = null;
    await Promise.all(
      sessions.map(async (s) => {
        if (!s) return;
        try {
          await s.release();
        } catch {
        }
      })
    );
    if (this.opts.probed.kind === "webgpu" && this.opts.probed.gpuDevice) {
      try {
        this.opts.probed.gpuDevice.destroy();
      } catch {
      }
    }
  }
  get descriptor() {
    return MODEL_REGISTRY[this.opts.model];
  }
  get activeDevice() {
    return this.opts.probed.kind;
  }
  /** Tokenise (transformers.js) then run the CLIP text encoder (raw ORT) →
   *  conditioning embedding [1, seqLen, embedDim]. */
  async embedPrompt(prompt) {
    if (!this.tokenizer || !this.textEncoderSession) {
      throw new Error("DiffusionEngine.init() not called");
    }
    const { textEmbedDim, sequenceLength } = this.descriptor;
    const encoded = await this.tokenizer(prompt, {
      padding: "max_length",
      max_length: sequenceLength,
      truncation: true
    });
    const rawIds = encoded.input_ids.data;
    const idFloats = new Float32Array(sequenceLength);
    for (let i = 0; i < sequenceLength; i++) {
      idFloats[i] = i < rawIds.length ? Number(rawIds[i]) : 0;
    }
    const inputIdsSpec = this.descriptor.textEncoderInputs.find((s) => s.name === "input_ids");
    if (!inputIdsSpec) {
      throw new Error(`Model '${this.descriptor.id}' textEncoderInputs missing 'input_ids' spec.`);
    }
    const idTensor = materializeTensor(inputIdsSpec.dtype, {
      data: idFloats,
      shape: [1, sequenceLength]
    });
    const out = await this.runSession(
      this.textEncoderSession,
      { [inputIdsSpec.name]: idTensor },
      "text_encoder"
    );
    const hidden = out.last_hidden_state?.data ?? pickFirstFloat32(out);
    if (!hidden) {
      throw new Error("Text encoder returned no Float32 output");
    }
    if (hidden.length !== sequenceLength * textEmbedDim) {
      throw new Error(
        `Text encoder dim mismatch: expected ${sequenceLength * textEmbedDim}, got ${hidden.length}. Check ${this.descriptor.hfRepo} text_encoder config.`
      );
    }
    return new Float32Array(hidden);
  }
  /** Sample a fresh latent from deterministic gaussian noise. */
  sampleInitialLatent(seed) {
    const latentH = this.opts.height / 8;
    const latentW = this.opts.width / 8;
    return gaussianNoise(1 * 4 * latentH * latentW, seed);
  }
  /**
   * Shared denoise primitive for both LCM and SD-Turbo. Uses the LCMScheduler
   * consistency-model step formula at the chosen timesteps; SD-Turbo with
   * timesteps=[999] degenerates to a single step that's equivalent to its
   * native one-shot generation up to a small numerical constant.
   */
  async denoise(inputs) {
    if (!this.unetSession || !this.vaeSession) {
      throw new Error("DiffusionEngine.init() not called");
    }
    const latentH = this.opts.height / 8;
    const latentW = this.opts.width / 8;
    const latentShape = [1, 4, latentH, latentW];
    const timesteps = inputs.timesteps ?? this.descriptor.defaultTimesteps;
    let sample = new Float32Array(inputs.latent);
    for (let i = 0; i < timesteps.length; i++) {
      inputs.onStep?.(i + 1, timesteps.length);
      const t = timesteps[i];
      const alpha = ALPHAS_CUMPROD[t] ?? 1e-3;
      const sqrtAlpha = Math.sqrt(alpha);
      const sqrtOneMinusAlpha = Math.sqrt(1 - alpha);
      const noisePred = await this.runUnet({
        sample,
        condEmbedding: inputs.condEmbedding,
        uncondEmbedding: inputs.uncondEmbedding,
        timestep: t,
        guidance: inputs.guidance,
        latentShape
      });
      const predictedX0 = new Float32Array(sample.length);
      for (let j = 0; j < sample.length; j++) {
        predictedX0[j] = (sample[j] - sqrtOneMinusAlpha * noisePred[j]) / sqrtAlpha;
      }
      if (i < timesteps.length - 1) {
        const tNext = timesteps[i + 1];
        const alphaNext = ALPHAS_CUMPROD[tNext] ?? 1e-3;
        const sqrtAlphaNext = Math.sqrt(alphaNext);
        const sqrtOneMinusAlphaNext = Math.sqrt(1 - alphaNext);
        const noise = gaussianNoise(sample.length, inputs.seed + i * 7919);
        for (let j = 0; j < sample.length; j++) {
          sample[j] = sqrtAlphaNext * predictedX0[j] + sqrtOneMinusAlphaNext * noise[j];
        }
      } else {
        sample = predictedX0;
      }
    }
    const pixels = await this.runVaeDecode(sample, latentH, latentW);
    return { pixels, latent: sample };
  }
  /**
   * Forward-noise a clean latent to the noise level corresponding to `timestep`.
   * Used by VideoEngine's img2img recursion: take the previous frame's clean
   * latent, re-noise it to a partial-schedule timestep, then run the remaining
   * denoise steps. Result is scene-content carried forward + prompt-driven
   * evolution, instead of "fresh interpretation per frame".
   *
   *   noised = sqrt(alpha_cumprod[t]) * clean + sqrt(1 - alpha_cumprod[t]) * noise
   *
   * — the standard DDPM forward diffusion at timestep t.
   */
  addNoiseToLatent(clean, timestep, seed) {
    const alpha = ALPHAS_CUMPROD[timestep] ?? 1e-3;
    const sqrtAlpha = Math.sqrt(alpha);
    const sqrtOneMinusAlpha = Math.sqrt(1 - alpha);
    const noise = gaussianNoise(clean.length, seed);
    const out = new Float32Array(clean.length);
    for (let i = 0; i < clean.length; i++) {
      out[i] = sqrtAlpha * clean[i] + sqrtOneMinusAlpha * noise[i];
    }
    return out;
  }
  /**
   * VAE-decode a clean latent to RGB pixels ([-1..1], layout [3, h, w]) WITHOUT
   * running the UNet denoise loop. This is the cheap half of `denoise()` and is
   * what makes keyframe interpolation worthwhile: the FrameInterpolator slerps
   * two keyframe latents into a tween latent, and the engine turns that tween
   * into a frame with one VAE decode instead of a full multi-step denoise.
   */
  async decodeLatent(latent) {
    if (!this.vaeSession) {
      throw new Error("DiffusionEngine.init() not called");
    }
    const latentH = this.opts.height / 8;
    const latentW = this.opts.width / 8;
    const expected = 4 * latentH * latentW;
    if (latent.length !== expected) {
      throw new Error(
        `decodeLatent: latent length ${latent.length} != expected ${expected} for ${this.opts.width}x${this.opts.height}.`
      );
    }
    return this.runVaeDecode(latent, latentH, latentW);
  }
  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  buildSessionOptions() {
    return buildOrtSessionOptions(this.opts.probed.kind);
  }
  /** Fetch the model + (optional) external-data buffers for one session.
   *  Pure I/O — no ORT calls. Split from session creation so the engine can
   *  parallelize downloads while still serialising the ORT create step. */
  async fetchSessionBuffers(file, label) {
    const onProgress = this.opts.onProgress;
    reportProgress(`Downloading ${label} (${file.model})\u2026`, onProgress);
    const modelBuf = await this.fetchWeight(file.model);
    let externalData = null;
    if (file.externalData) {
      reportProgress(`Downloading ${label} weight data (${file.externalData})\u2026`, onProgress);
      const dataBuf = await this.fetchWeight(file.externalData);
      externalData = { name: basename(file.externalData), buf: dataBuf };
    }
    return { label, modelBuf, externalData };
  }
  /** Create an ORT session from already-downloaded buffers. Caller MUST call
   *  this serially across sessions when any of them carry external data —
   *  ORT-web's external-data mount Map is global and the `finally` of every
   *  session create unmounts it, so concurrent creates race. The init() call
   *  site enforces serial creation. */
  async createSessionFromBuffers(bufs, baseOptions) {
    const onProgress = this.opts.onProgress;
    const options = { ...baseOptions };
    if (bufs.externalData) {
      options.externalData = [
        { path: bufs.externalData.name, data: new Uint8Array(bufs.externalData.buf) }
      ];
    }
    reportProgress(`Creating ${bufs.label} ORT session\u2026`, onProgress);
    try {
      const session = await ort2.InferenceSession.create(
        new Uint8Array(bufs.modelBuf),
        options
      );
      reportProgress(`${bufs.label} ready.`, onProgress);
      return session;
    } catch (err) {
      throw explainOrtError(
        err,
        `${bufs.label} session create`,
        this.descriptor.id,
        this.descriptor.minVramMb,
        this.opts.probed.approxMemoryMb
      );
    }
  }
  /** Wrap session.run() so DXGI_ERROR_DEVICE_HUNG, std::bad_alloc, "Device is
   *  lost", and similar runtime ORT failures become actionable messages
   *  instead of raw WebGPU stack traces. Single sink — every session.run
   *  call in the engine goes through here. */
  async runSession(session, feeds, label) {
    try {
      return await session.run(feeds);
    } catch (err) {
      throw explainOrtError(
        err,
        `${label} session run`,
        this.descriptor.id,
        this.descriptor.minVramMb,
        this.opts.probed.approxMemoryMb
      );
    }
  }
  async fetchWeight(file) {
    return getOrFetchWeight({
      cacheKey: `${this.opts.model}/${file}`,
      hfRepo: this.descriptor.hfRepo,
      hfPath: file,
      sources: this.opts.weightSources,
      apiKey: this.opts.apiKey,
      r2Base: this.opts.r2Base,
      onProgress: (loaded, total) => this.opts.onWeightProgress?.(file, loaded, total)
    });
  }
  buildUnetFeeds(args) {
    const ctx = {
      descriptor: this.descriptor,
      sample: args.sample,
      condEmbedding: args.condEmbedding,
      timestep: args.timestep,
      guidance: args.guidance,
      latentShape: args.latentShape
    };
    const feeds = {};
    for (const spec of this.descriptor.unetInputs) {
      const builder = UNET_INPUT_BUILDERS[spec.name];
      if (!builder) {
        throw new Error(
          `Model '${this.descriptor.id}' declares UNet input '${spec.name}' but no builder is registered. Add it to UNET_INPUT_BUILDERS in diffusion-engine.ts.`
        );
      }
      feeds[spec.name] = materializeTensor(spec.dtype, builder(ctx));
    }
    return feeds;
  }
  async runUnet(args) {
    const session = this.unetSession;
    const condFeeds = this.buildUnetFeeds({
      sample: args.sample,
      condEmbedding: args.condEmbedding,
      timestep: args.timestep,
      guidance: args.guidance,
      latentShape: args.latentShape
    });
    const condOut = await this.runSession(session, condFeeds, "unet (conditional)");
    const condNoise = pickFirstFloat32(condOut);
    if (!condNoise) throw new Error("UNet returned no Float32 output");
    if (!args.uncondEmbedding || args.guidance <= 0) {
      return condNoise;
    }
    const uncondFeeds = this.buildUnetFeeds({
      sample: args.sample,
      condEmbedding: args.uncondEmbedding,
      timestep: args.timestep,
      guidance: args.guidance,
      latentShape: args.latentShape
    });
    const uncondOut = await this.runSession(session, uncondFeeds, "unet (unconditional)");
    const uncondNoise = pickFirstFloat32(uncondOut);
    if (!uncondNoise) throw new Error("UNet unconditional pass returned no Float32 output");
    const guided = new Float32Array(condNoise.length);
    for (let i = 0; i < condNoise.length; i++) {
      guided[i] = uncondNoise[i] + args.guidance * (condNoise[i] - uncondNoise[i]);
    }
    return guided;
  }
  async runVaeDecode(latent, h, w) {
    const session = this.vaeSession;
    const scaled = new Float32Array(latent.length);
    const scale = this.descriptor.vaeScalingFactor;
    for (let i = 0; i < latent.length; i++) scaled[i] = latent[i] / scale;
    const input = new ort2.Tensor("float32", scaled, [1, 4, h, w]);
    const out = await this.runSession(session, { latent_sample: input }, "vae_decoder");
    const pixels = pickFirstFloat32(out);
    if (!pixels) throw new Error("VAE decoder returned no Float32 output");
    return pixels;
  }
};
function gaussianNoise(length, seed) {
  const out = new Float32Array(length);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    state = state * 1664525 + 1013904223 >>> 0;
    const u1 = (state + 1) / 4294967296;
    state = state * 1664525 + 1013904223 >>> 0;
    const u2 = (state + 1) / 4294967296;
    out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  return out;
}
function pickFirstFloat32(result) {
  for (const value of Object.values(result)) {
    const data = value.data;
    if (data instanceof Float32Array) return data;
  }
  return null;
}
function checkMemoryForModel(approxMemoryMb, minVramMb, modelId) {
  if (approxMemoryMb === null) return null;
  if (approxMemoryMb >= minVramMb) return null;
  return `Insufficient memory for ${modelId}: device reports ~${(approxMemoryMb / 1024).toFixed(1)} GB available, model needs at least ~${(minVramMb / 1024).toFixed(1)} GB. ${lighterModelHint(modelId, approxMemoryMb)}`;
}
function lighterModelHint(failingModelId, availableMb) {
  const failingMin = MODEL_REGISTRY[failingModelId]?.minVramMb ?? Infinity;
  const alternatives = Object.values(MODEL_REGISTRY).filter((m) => m.id !== failingModelId).filter((m) => m.minVramMb < failingMin).filter((m) => availableMb === null || m.minVramMb <= availableMb).sort((a, b) => a.minVramMb - b.minVramMb).map((m) => m.id);
  if (alternatives.length === 0) {
    return "No lighter model is available \u2014 close other GPU-heavy tabs and retry.";
  }
  return `Try a lighter model (${alternatives.join(", ")}) or close other GPU-heavy tabs.`;
}
function explainOrtError(err, label, modelId, minVramMb, availableMemoryMb = null) {
  const message = err instanceof Error ? err.message : String(err);
  if (/bad_alloc|out of memory|memory access out of bounds/i.test(message)) {
    return new Error(
      `Out of memory during ${label} for ${modelId} (needs ~${(minVramMb / 1024).toFixed(1)} GB). ${lighterModelHint(modelId, availableMemoryMb)} Original error: ${message}`
    );
  }
  if (/DXGI_ERROR_DEVICE_HUNG|Device.*is lost|GPUDevice.*lost|mapAsync.*lost/i.test(message)) {
    return new Error(
      `GPU device was lost during ${label} for ${modelId} \u2014 typically a Windows TDR (driver timeout, ~2 s per kernel). The model is too heavy for this GPU at the current resolution. Try a lower resolution (e.g. 256\xD7256), pick a lighter model, or switch the device target to CPU. Original error: ${message}`
    );
  }
  if (/InsertedPrecisionFreeCast|SimplifiedLayerNormFusion|graph_utils\.cc/.test(message)) {
    return new Error(
      `${label} ORT session refused to load due to a graph-fusion crash. This usually means graphOptimizationLevel is too aggressive \u2014 verify buildOrtSessionOptions still pins 'basic'. Original error: ${message}`
    );
  }
  return err instanceof Error ? err : new Error(message);
}
function buildOrtSessionOptions(device) {
  const base = {
    graphOptimizationLevel: "basic",
    // Drop ORT's `[W:` warnings (e.g. "VerifyEachNodeIsAssignedToAnEp: some
    // nodes were not assigned to the preferred EP"). These are informational
    // — every shape-op fallback to CPU logs one per session. With 3 sessions
    // and per-frame reuse, the console becomes unreadable. Severity 3 = error,
    // so real failures still log; warnings are silenced.
    logSeverityLevel: 3
  };
  if (device === "webnn") return { ...base, executionProviders: ["webnn", "wasm"] };
  if (device === "webgpu") return { ...base, executionProviders: ["webgpu", "wasm"] };
  return { ...base, executionProviders: ["wasm"] };
}
function basename(path) {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}
function assertSessionMatchesSpec(sessionLabel, session, specs) {
  const declared = specs.map((s) => s.name);
  const actual = session.inputNames;
  const missing = declared.filter((n) => !actual.includes(n));
  if (missing.length > 0) {
    throw new Error(
      `Registry/model mismatch on ${sessionLabel}: declared input(s) [${missing.join(", ")}] are not in the model's inputNames [${actual.join(", ")}]. Update MODEL_REGISTRY in diffusion-engine.ts to match the actual export.`
    );
  }
}

// src/engine/frame-interpolator.ts
function slerp(a, b, t) {
  if (a.length !== b.length) {
    throw new Error(`slerp: length mismatch (${a.length} vs ${b.length})`);
  }
  if (t <= 0) return new Float32Array(a);
  if (t >= 1) return new Float32Array(b);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB) || 1;
  let cosTheta = dot / denom;
  if (cosTheta > 1) cosTheta = 1;
  if (cosTheta < -1) cosTheta = -1;
  const theta = Math.acos(cosTheta);
  const sinTheta = Math.sin(theta);
  const out = new Float32Array(a.length);
  if (sinTheta < 1e-4) {
    for (let i = 0; i < a.length; i++) {
      out[i] = a[i] * (1 - t) + b[i] * t;
    }
    return out;
  }
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  for (let i = 0; i < a.length; i++) {
    out[i] = wa * a[i] + wb * b[i];
  }
  return out;
}
function planKeyframeIndices(totalFrames, factor) {
  const total = Math.max(0, Math.floor(totalFrames));
  if (total === 0) return [];
  if (total === 1) return [0];
  const step = Math.max(1, Math.floor(factor));
  if (step === 1) return Array.from({ length: total }, (_, i) => i);
  const indices = [];
  for (let i = 0; i < total; i += step) indices.push(i);
  const last = total - 1;
  if (indices[indices.length - 1] !== last) indices.push(last);
  return indices;
}
function buildInterpolatedSequence(keyframes) {
  if (keyframes.length === 0) return [];
  if (keyframes.length === 1) {
    return [{ outputIndex: keyframes[0].outputIndex, isTween: false, keyframeIndex: 0 }];
  }
  const slots = [];
  for (let k = 0; k < keyframes.length - 1; k++) {
    const k0 = keyframes[k];
    const k1 = keyframes[k + 1];
    slots.push({ outputIndex: k0.outputIndex, isTween: false, keyframeIndex: k });
    const span = k1.outputIndex - k0.outputIndex;
    for (let x = k0.outputIndex + 1; x < k1.outputIndex; x++) {
      const t = (x - k0.outputIndex) / span;
      slots.push({ outputIndex: x, isTween: true, latent: slerp(k0.latent, k1.latent, t) });
    }
  }
  const lastIdx = keyframes.length - 1;
  slots.push({
    outputIndex: keyframes[lastIdx].outputIndex,
    isTween: false,
    keyframeIndex: lastIdx
  });
  return slots;
}

// src/engine/mamba-coherence.ts
function projectState(state, targetDim) {
  const out = new Float32Array(targetDim);
  if (state.data.length === 0) return out;
  for (let i = 0; i < state.data.length; i++) {
    const v = state.data[i];
    const targetIdx = mixIndex(i, state.dim, state.channels, state.order, targetDim);
    out[targetIdx] += v;
  }
  let norm = 0;
  for (let i = 0; i < targetDim; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < targetDim; i++) out[i] /= norm;
  return out;
}
function applyToPrompt(args) {
  const { ctx, promptEmbedding, seqLen, embedDim } = args;
  if (ctx.strength <= 0) return promptEmbedding;
  const stateVec = projectState(ctx.state, embedDim);
  const out = new Float32Array(promptEmbedding);
  const tokenOffset = (seqLen - 1) * embedDim;
  for (let d = 0; d < embedDim; d++) {
    const original = out[tokenOffset + d];
    out[tokenOffset + d] = original * (1 - ctx.strength) + stateVec[d] * ctx.strength;
  }
  return out;
}
function blendNoise(anchor, frame, alpha) {
  if (anchor.length !== frame.length) {
    throw new Error(`blendNoise: length mismatch (${anchor.length} vs ${frame.length})`);
  }
  if (alpha <= 0) return new Float32Array(anchor);
  if (alpha >= 1) return new Float32Array(frame);
  const a = Math.sqrt(1 - alpha);
  const b = Math.sqrt(alpha);
  const out = new Float32Array(anchor.length);
  for (let i = 0; i < anchor.length; i++) {
    out[i] = a * anchor[i] + b * frame[i];
  }
  return out;
}
function anchorWalkLatent(anchor, walkStart, walkEnd, frameIdx, frameCount, motionAmount) {
  const t = frameCount > 1 ? frameIdx / (frameCount - 1) : 0;
  const frameNoise = slerp(walkStart, walkEnd, t);
  return blendNoise(anchor, frameNoise, motionAmount);
}
function shiftLatent(latent, shape, dx, dy) {
  const { channels, height, width } = shape;
  if (latent.length !== channels * height * width) {
    throw new Error(
      `shiftLatent: length ${latent.length} doesn't match shape ${channels}x${height}x${width}=${channels * height * width}`
    );
  }
  if (dx === 0 && dy === 0) return new Float32Array(latent);
  const out = new Float32Array(latent.length);
  const idx = (c, y, x) => c * (height * width) + y * width + x;
  const clamp2 = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < height; y++) {
      const srcY = clamp2(y - dy, 0, height - 1);
      for (let x = 0; x < width; x++) {
        const srcX = clamp2(x - dx, 0, width - 1);
        out[idx(c, y, x)] = latent[idx(c, srcY, srcX)];
      }
    }
  }
  return out;
}
function scaleLatent(latent, shape, scale) {
  const { channels, height, width } = shape;
  if (latent.length !== channels * height * width) {
    throw new Error(
      `scaleLatent: length ${latent.length} doesn't match shape ${channels}x${height}x${width}=${channels * height * width}`
    );
  }
  if (scale === 1 || !Number.isFinite(scale) || scale <= 0) return new Float32Array(latent);
  const out = new Float32Array(latent.length);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const idx = (c, y, x) => c * (height * width) + y * width + x;
  const clamp2 = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < height; y++) {
      const srcYf = cy + (y - cy) / scale;
      const y0 = clamp2(Math.floor(srcYf), 0, height - 1);
      const y1 = clamp2(y0 + 1, 0, height - 1);
      const wy = srcYf - Math.floor(srcYf);
      for (let x = 0; x < width; x++) {
        const srcXf = cx + (x - cx) / scale;
        const x0 = clamp2(Math.floor(srcXf), 0, width - 1);
        const x1 = clamp2(x0 + 1, 0, width - 1);
        const wx = srcXf - Math.floor(srcXf);
        const top = latent[idx(c, y0, x0)] * (1 - wx) + latent[idx(c, y0, x1)] * wx;
        const bot = latent[idx(c, y1, x0)] * (1 - wx) + latent[idx(c, y1, x1)] * wx;
        out[idx(c, y, x)] = top * (1 - wy) + bot * wy;
      }
    }
  }
  return out;
}
function shouldApplyLatentResidualBias(mode, useImg2Img) {
  return mode === "latent-residual" && !useImg2Img;
}
function applyToLatent(args) {
  const { ctx, latent } = args;
  if (ctx.strength <= 0) return latent;
  const channels = 4;
  const spatial = latent.length / channels;
  const stateVec = projectState(ctx.state, channels);
  const out = new Float32Array(latent);
  for (let c = 0; c < channels; c++) {
    const bias = stateVec[c] * ctx.strength;
    const base = c * spatial;
    for (let i = 0; i < spatial; i++) {
      out[base + i] += bias;
    }
  }
  return out;
}
function advanceState(state, input) {
  const next = new Float32Array(state.data.length);
  const decay = 0.92;
  const pooled = new Float32Array(state.channels);
  const stride = Math.max(1, Math.floor(input.length / state.channels));
  for (let c = 0; c < state.channels; c++) {
    let sum = 0;
    let count = 0;
    for (let i = c * stride; i < (c + 1) * stride && i < input.length; i++) {
      sum += input[i];
      count++;
    }
    pooled[c] = count > 0 ? sum / count : 0;
  }
  for (let c = 0; c < state.channels; c++) {
    for (let k = 0; k < state.order; k++) {
      const idx = c * state.order + k;
      next[idx] = decay * (state.data[idx] ?? 0) + 0.1 * pooled[c];
    }
  }
  return {
    data: Array.from(next),
    dim: state.dim,
    order: state.order,
    channels: state.channels,
    step: state.step + 1
  };
}
function emptyState(opts) {
  return {
    data: new Array(opts.channels * opts.order).fill(0),
    dim: opts.dim,
    order: opts.order,
    channels: opts.channels,
    step: 0
  };
}
function mixIndex(i, dim, channels, order, targetDim) {
  const seed = i * 2654435761 ^ dim * 374761393 ^ channels * 1597334677 ^ order * 668265263;
  return Math.abs(seed) % targetDim;
}

// src/engine/motion-interpolator.ts
var CHANNELS = 3;
var FINE_RADIUS = 2;
function luma(rgb, width, height) {
  const n = width * height;
  if (rgb.length !== CHANNELS * n) {
    throw new Error(`luma: expected ${CHANNELS * n} values for ${width}x${height}, got ${rgb.length}`);
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = 0.299 * rgb[i] + 0.587 * rgb[n + i] + 0.114 * rgb[2 * n + i];
  }
  return out;
}
var clampInt = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
function downscale(plane, width, height, factor) {
  if (factor <= 1) return { data: plane, width, height };
  const w2 = Math.max(1, Math.floor(width / factor));
  const h2 = Math.max(1, Math.floor(height / factor));
  const out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = 0; dy < factor; dy++) {
        const sy = y * factor + dy;
        if (sy >= height) break;
        for (let dx = 0; dx < factor; dx++) {
          const sx = x * factor + dx;
          if (sx >= width) break;
          sum += plane[sy * width + sx];
          count++;
        }
      }
      out[y * w2 + x] = count > 0 ? sum / count : 0;
    }
  }
  return { data: out, width: w2, height: h2 };
}
function blockSad(a, b, width, height, x0, y0, x1, y1, dx, dy) {
  let sad = 0;
  for (let y = y0; y < y1; y++) {
    const sy = clampInt(y + dy, 0, height - 1);
    for (let x = x0; x < x1; x++) {
      const sx = clampInt(x + dx, 0, width - 1);
      sad += Math.abs(a[y * width + x] - b[sy * width + sx]);
    }
  }
  return sad;
}
function searchBlock(a, b, width, height, x0, y0, x1, y1, predictDx, predictDy, radius) {
  let bestDx = predictDx;
  let bestDy = predictDy;
  let bestSad = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cdx = predictDx + dx;
      const cdy = predictDy + dy;
      const sad = blockSad(a, b, width, height, x0, y0, x1, y1, cdx, cdy);
      const better = sad < bestSad - 1e-6 || Math.abs(sad - bestSad) < 1e-6 && (cdx - predictDx) ** 2 + (cdy - predictDy) ** 2 < (bestDx - predictDx) ** 2 + (bestDy - predictDy) ** 2;
      if (better) {
        bestSad = sad;
        bestDx = cdx;
        bestDy = cdy;
      }
    }
  }
  return { dx: bestDx, dy: bestDy };
}
function parabolicOffset(sm1, s0, sp1) {
  if (s0 <= 1e-9) return 0;
  const denom = sm1 - 2 * s0 + sp1;
  if (Math.abs(denom) < 1e-9) return 0;
  const off = 0.5 * (sm1 - sp1) / denom;
  return off < -0.5 ? -0.5 : off > 0.5 ? 0.5 : off;
}
function estimateBlockMotion(a, b, width, height, opts = {}) {
  const blockSize = Math.max(4, Math.floor(opts.blockSize ?? 16));
  const searchRadius = Math.max(1, Math.floor(opts.searchRadius ?? 8));
  const levels = Math.max(1, Math.floor(opts.levels ?? 3));
  const la = luma(a, width, height);
  const lb = luma(b, width, height);
  const cols = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);
  const vec = new Float32Array(cols * rows * 2);
  const factor = 2 ** (levels - 1);
  const coarseA = downscale(la, width, height, factor);
  const coarseB = downscale(lb, width, height, factor);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * blockSize;
      const y0 = by * blockSize;
      const x1 = Math.min(x0 + blockSize, width);
      const y1 = Math.min(y0 + blockSize, height);
      let predictDx = 0;
      let predictDy = 0;
      if (factor > 1) {
        const cx0 = Math.floor(x0 / factor);
        const cy0 = Math.floor(y0 / factor);
        const cx1 = Math.max(cx0 + 1, Math.floor(x1 / factor));
        const cy1 = Math.max(cy0 + 1, Math.floor(y1 / factor));
        const coarse = searchBlock(
          coarseA.data,
          coarseB.data,
          coarseA.width,
          coarseA.height,
          cx0,
          cy0,
          cx1,
          cy1,
          0,
          0,
          searchRadius
        );
        predictDx = coarse.dx * factor;
        predictDy = coarse.dy * factor;
      } else {
        const full = searchBlock(la, lb, width, height, x0, y0, x1, y1, 0, 0, searchRadius);
        predictDx = full.dx;
        predictDy = full.dy;
      }
      const fine = searchBlock(la, lb, width, height, x0, y0, x1, y1, predictDx, predictDy, FINE_RADIUS);
      const s0 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx, fine.dy);
      const sxm1 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx - 1, fine.dy);
      const sxp1 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx + 1, fine.dy);
      const sym1 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx, fine.dy - 1);
      const syp1 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx, fine.dy + 1);
      const bi = (by * cols + bx) * 2;
      vec[bi] = fine.dx + parabolicOffset(sxm1, s0, sxp1);
      vec[bi + 1] = fine.dy + parabolicOffset(sym1, s0, syp1);
    }
  }
  return { blockSize, cols, rows, vec };
}
function sampleBilinear(plane, width, height, fx, fy) {
  const x0 = clampInt(Math.floor(fx), 0, width - 1);
  const x1 = clampInt(x0 + 1, 0, width - 1);
  const y0 = clampInt(Math.floor(fy), 0, height - 1);
  const y1 = clampInt(y0 + 1, 0, height - 1);
  const wx = fx - Math.floor(fx);
  const wy = fy - Math.floor(fy);
  const top = plane[y0 * width + x0] * (1 - wx) + plane[y0 * width + x1] * wx;
  const bot = plane[y1 * width + x0] * (1 - wx) + plane[y1 * width + x1] * wx;
  return top * (1 - wy) + bot * wy;
}
function interpolateFrames(a, b, width, height, t, field) {
  if (a.length !== b.length) {
    throw new Error(`interpolateFrames: length mismatch (${a.length} vs ${b.length})`);
  }
  const n = width * height;
  const out = new Float32Array(a.length);
  const { blockSize, cols } = field;
  for (let y = 0; y < height; y++) {
    const by = Math.min(Math.floor(y / blockSize), field.rows - 1);
    for (let x = 0; x < width; x++) {
      const bx = Math.min(Math.floor(x / blockSize), cols - 1);
      const bi = (by * cols + bx) * 2;
      const dx = field.vec[bi];
      const dy = field.vec[bi + 1];
      const ax = x - t * dx;
      const ay = y - t * dy;
      const bxs = x + (1 - t) * dx;
      const bys = y + (1 - t) * dy;
      for (let c = 0; c < CHANNELS; c++) {
        const pa = a.subarray(c * n, (c + 1) * n);
        const pb = b.subarray(c * n, (c + 1) * n);
        const va = sampleBilinear(pa, width, height, ax, ay);
        const vb = sampleBilinear(pb, width, height, bxs, bys);
        out[c * n + (y * width + x)] = (1 - t) * va + t * vb;
      }
    }
  }
  return out;
}

// src/engine/scene-planner.ts
var import_builderforce_sdk = require("@seanhogg/builderforce-sdk");
var DEFAULT_PLANNER_MODEL = "googleai/gemini-2.5-flash";
var CAMERA_MOVES = [
  "static",
  "pan-left",
  "pan-right",
  "tilt-up",
  "tilt-down",
  "dolly-in",
  "dolly-out"
];
var DIRECTOR_SYSTEM = "You are a film director and character designer for an AI video generator. Given a short concept, produce (1) a one-paragraph visual treatment describing tone, setting, lighting and arc, and (2) a character bible: for each distinct character, a LOCKED visual description (age, build, hair, wardrobe, colour palette) that must stay identical across every shot. Keep each appearance under 200 characters and concrete (a diffusion model reads it verbatim). Output only JSON matching the schema.";
var SHOT_PLANNER_SYSTEM = "You are a storyboard and shot planner for an AI video generator. Given a treatment and character bible, break the scene into a sequence of shots. For each shot write a single detailed diffusion prompt (subject, environment, lighting, palette, camera angle, visual style) WITHOUT restating character appearance \u2014 reference characters by id in characterIds and the engine appends their locked description. Pick one camera move per shot from the allowed list. Size each shot's frame budget so the totals sum to the requested total. Output only JSON matching the schema.";
var DIRECTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["treatment", "characters"],
  properties: {
    treatment: { type: "string" },
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "appearance"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          appearance: { type: "string" }
        }
      }
    }
  }
};
var SHOT_PLANNER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["shots"],
  properties: {
    shots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "prompt", "characterIds", "camera", "action", "durationFrames"],
        properties: {
          id: { type: "string" },
          prompt: { type: "string" },
          characterIds: { type: "array", items: { type: "string" } },
          camera: { type: "string", enum: [...CAMERA_MOVES] },
          action: { type: "string" },
          durationFrames: { type: "integer", minimum: 1 }
        }
      }
    }
  }
};
async function planScene(opts, client) {
  const c = client ?? new import_builderforce_sdk.BuilderforceClient({ apiKey: opts.apiKey, baseUrl: opts.baseUrl });
  const model = opts.plannerModel ?? DEFAULT_PLANNER_MODEL;
  const director = await directorPass(c, model, opts);
  const planner = await shotPlannerPass(c, model, opts, director);
  const shots = normaliseShotBudget(
    sanitiseShots(planner.shots, director.characters),
    opts.totalFrames
  );
  return {
    treatment: director.treatment,
    characters: director.characters,
    shots
  };
}
async function directorPass(client, model, opts) {
  const parsed = await structuredCall(client, {
    model,
    system: DIRECTOR_SYSTEM,
    user: `Concept: ${opts.request}
Target length: ${opts.totalFrames} frames.`,
    schemaName: "director",
    schema: DIRECTOR_SCHEMA,
    signal: opts.signal
  });
  return {
    treatment: typeof parsed?.treatment === "string" ? parsed.treatment : opts.request,
    characters: Array.isArray(parsed?.characters) ? parsed.characters : []
  };
}
async function shotPlannerPass(client, model, opts, director) {
  const characterList = director.characters.map((ch) => `${ch.id} (${ch.name}): ${ch.appearance}`).join("\n");
  const parsed = await structuredCall(client, {
    model,
    system: SHOT_PLANNER_SYSTEM,
    user: `Treatment: ${director.treatment}

Characters:
${characterList || "(none)"}

Allowed camera moves: ${CAMERA_MOVES.join(", ")}
Distribute exactly ${opts.totalFrames} frames across the shots.`,
    schemaName: "shot_planner",
    schema: SHOT_PLANNER_SCHEMA,
    signal: opts.signal
  });
  return { shots: Array.isArray(parsed?.shots) ? parsed.shots : [] };
}
function cameraMoveToMotion(move) {
  switch (move) {
    case "pan-left":
      return { cameraMotion: { dx: -1, dy: 0 }, imgToImgStrength: 0.6 };
    case "pan-right":
      return { cameraMotion: { dx: 1, dy: 0 }, imgToImgStrength: 0.6 };
    case "tilt-up":
      return { cameraMotion: { dx: 0, dy: -1 }, imgToImgStrength: 0.6 };
    case "tilt-down":
      return { cameraMotion: { dx: 0, dy: 1 }, imgToImgStrength: 0.6 };
    case "dolly-in":
      return { cameraMotion: { dx: 0, dy: 0, zoom: 1.04 }, imgToImgStrength: 0.55 };
    case "dolly-out":
      return { cameraMotion: { dx: 0, dy: 0, zoom: 1 / 1.04 }, imgToImgStrength: 0.55 };
    case "static":
    default:
      return { imgToImgStrength: 0 };
  }
}
function composeShotPrompt(shot, characters) {
  const byId = new Map(characters.map((ch) => [ch.id, ch]));
  const appearances = shot.characterIds.map((id) => byId.get(id)).filter((ch) => Boolean(ch)).map((ch) => `${ch.name}: ${ch.appearance}`);
  if (appearances.length === 0) return shot.prompt;
  return `${shot.prompt}. ${appearances.join(". ")}`;
}
function storyboardFrameCount(storyboard) {
  return storyboard.shots.reduce((sum, s) => sum + s.durationFrames, 0);
}
function sanitiseShots(shots, characters) {
  const validIds = new Set(characters.map((c) => c.id));
  return shots.filter((s) => s && typeof s.prompt === "string" && s.prompt.trim().length > 0).map((s, i) => ({
    id: typeof s.id === "string" && s.id ? s.id : `shot-${i + 1}`,
    prompt: s.prompt.trim(),
    characterIds: Array.isArray(s.characterIds) ? s.characterIds.filter((id) => validIds.has(id)) : [],
    camera: CAMERA_MOVES.includes(s.camera) ? s.camera : "static",
    action: typeof s.action === "string" ? s.action : "",
    durationFrames: Number.isFinite(s.durationFrames) && s.durationFrames > 0 ? Math.floor(s.durationFrames) : 1
  }));
}
function normaliseShotBudget(shots, total) {
  const target = Math.max(1, Math.floor(total));
  if (shots.length === 0) {
    return [
      {
        id: "shot-1",
        prompt: "",
        characterIds: [],
        camera: "static",
        action: "",
        durationFrames: target
      }
    ];
  }
  const sum = shots.reduce((acc, s) => acc + s.durationFrames, 0) || shots.length;
  let allocated = 0;
  const out = shots.map((s, i) => {
    const frames = i === shots.length - 1 ? Math.max(1, target - allocated) : Math.max(1, Math.round(s.durationFrames / sum * target));
    allocated += frames;
    return { ...s, durationFrames: frames };
  });
  return out;
}
async function structuredCall(client, args) {
  const completion = await client.chat.completions.create({
    model: args.model,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user }
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: args.schemaName, schema: args.schema, strict: true }
    },
    temperature: 0.7,
    max_tokens: 1500,
    signal: args.signal
  });
  const text = completion.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// src/engine/frame-validator.ts
var import_builderforce_sdk2 = require("@seanhogg/builderforce-sdk");
var DEFAULT_VALIDATOR_MODEL = "googleai/gemini-2.5-flash";
var DEFAULT_PASS_THRESHOLD = 0.6;
var ISSUE_KINDS = [
  "character-drift",
  "continuity",
  "prompt-mismatch",
  "artifact",
  "other"
];
var VALIDATOR_SYSTEM = "You are a strict continuity supervisor for AI-generated video frames. You are shown one frame plus the description of what it should depict and the locked appearance of any characters. Judge how well the frame matches. Report a score from 0 (wrong) to 1 (perfect) and list concrete issues: character-drift (a character looks different from their locked description), continuity, prompt-mismatch (frame ignores the described subject/action), artifact (melted faces, extra limbs, garbled text), or other. Output only JSON.";
var VALIDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "issues"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 1 },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "detail"],
        properties: {
          kind: { type: "string", enum: [...ISSUE_KINDS] },
          detail: { type: "string" }
        }
      }
    }
  }
};
async function validateFrame(opts, client) {
  const threshold = opts.passThreshold ?? DEFAULT_PASS_THRESHOLD;
  const characterBlock = opts.characters && opts.characters.length > 0 ? `Characters that must appear exactly as described:
` + opts.characters.map((c) => `- ${c.name}: ${c.appearance}`).join("\n") : "No specific characters to verify.";
  try {
    const c = client ?? new import_builderforce_sdk2.BuilderforceClient({ apiKey: opts.apiKey, baseUrl: opts.baseUrl });
    const completion = await c.chat.completions.create({
      model: opts.validatorModel ?? DEFAULT_VALIDATOR_MODEL,
      messages: [
        { role: "system", content: VALIDATOR_SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Shot description: ${opts.shotDescription}

${characterBlock}`
            },
            { type: "image_url", image_url: { url: opts.frameDataUrl, detail: "low" } }
          ]
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "frame_validation", schema: VALIDATION_SCHEMA, strict: true }
      },
      temperature: 0,
      max_tokens: 600,
      signal: opts.signal
    });
    const text = completion.choices?.[0]?.message?.content;
    const verdict = parseVerdict(typeof text === "string" ? text : null);
    if (!verdict) return permissive();
    return { ok: verdict.score >= threshold, score: verdict.score, issues: verdict.issues };
  } catch {
    return permissive();
  }
}
function permissive() {
  return { ok: true, score: 1, issues: [] };
}
function parseVerdict(text) {
  if (!text) return null;
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      obj = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj;
  const score = typeof rec.score === "number" ? clamp01(rec.score) : null;
  if (score === null) return null;
  const issues = Array.isArray(rec.issues) ? rec.issues.filter((i) => Boolean(i) && typeof i === "object").map((i) => ({
    kind: ISSUE_KINDS.includes(i.kind) ? i.kind : "other",
    detail: typeof i.detail === "string" ? i.detail : ""
  })) : [];
  return { score, issues };
}
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// src/engine/llm-bridge.ts
var import_builderforce_sdk3 = require("@seanhogg/builderforce-sdk");
var SYSTEM_PROMPT = 'You are a visual prompt engineer for a text-to-video diffusion model. Rewrite the user prompt into a single detailed paragraph optimized for a Stable Diffusion-class image model. Include: subject, action, environment, lighting, colour palette, camera angle, and a visual style descriptor (e.g. cinematic, anime, photoreal). Do not use newlines. Do not preface with "Here is" or any meta-commentary \u2014 output only the rewritten prompt. Keep it under 220 characters.';
async function expandPrompt(opts) {
  const client = new import_builderforce_sdk3.BuilderforceClient({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl
  });
  const completion = await client.chat.completions.create({
    // Explicit lightweight model — the gateway still failovers across the
    // cascade if this is cooled, but we avoid relying on undocumented
    // "unknown id → substitute" behaviour that a future strict-pin mode
    // would break. Override via `promptModel` if a different model is wanted.
    model: opts.promptModel ?? "googleai/gemini-2.5-flash-lite",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: opts.prompt }
    ],
    max_tokens: 200,
    temperature: 0.7
  });
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) {
    return opts.prompt;
  }
  return text;
}

// src/engine/webcodecs-muxer.ts
var import_mp4_muxer = require("mp4-muxer");
async function muxFramesToMp4(frames, opts) {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("WebCodecs VideoEncoder is not available in this browser");
  }
  const muxer = new import_mp4_muxer.Muxer({
    target: new import_mp4_muxer.ArrayBufferTarget(),
    video: {
      codec: "avc",
      width: opts.width,
      height: opts.height,
      frameRate: opts.fps
    },
    fastStart: "in-memory"
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      throw err;
    }
  });
  encoder.configure({
    codec: "avc1.42E01F",
    width: opts.width,
    height: opts.height,
    bitrate: opts.bitrate ?? 2e6,
    framerate: opts.fps
  });
  const microsPerFrame = Math.round(1e6 / opts.fps);
  for (let i = 0; i < frames.length; i++) {
    if (opts.signal?.aborted) {
      encoder.close();
      throw new DOMException("Mux aborted", "AbortError");
    }
    const bitmap = await frameToImageBitmap(frames[i], opts.width, opts.height);
    const videoFrame = new VideoFrame(bitmap, {
      timestamp: i * microsPerFrame,
      duration: microsPerFrame
    });
    encoder.encode(videoFrame, { keyFrame: i === 0 });
    videoFrame.close();
    bitmap.close();
  }
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  const { buffer } = muxer.target;
  return new Blob([buffer], { type: "video/mp4" });
}
async function frameToImageBitmap(frame, width, height) {
  const imageData = new ImageData(
    frame.rgba,
    width,
    height
  );
  return createImageBitmap(imageData);
}
function pixelsToRgba(pixels, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  const channelSize = width * height;
  for (let i = 0; i < channelSize; i++) {
    const r = pixels[0 * channelSize + i];
    const g = pixels[1 * channelSize + i];
    const b = pixels[2 * channelSize + i];
    out[i * 4 + 0] = clamp((r + 1) * 127.5);
    out[i * 4 + 1] = clamp((g + 1) * 127.5);
    out[i * 4 + 2] = clamp((b + 1) * 127.5);
    out[i * 4 + 3] = 255;
  }
  return out;
}
function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

// src/engine/video-engine.ts
var DEFAULT_WIDTH = 512;
var DEFAULT_HEIGHT = 512;
var DEFAULT_WEIGHT_SOURCES = ["r2-proxy", "huggingface-cdn"];
var DEFAULT_COHERENCE = "prompt-bias";
var DEFAULT_COHERENCE_STRENGTH = 0.5;
var DEFAULT_MOTION_AMOUNT = 0.15;
var DEFAULT_REFINEMENT_STRENGTH = 0.4;
var VideoEngine = class _VideoEngine {
  constructor(opts, diffusion, mambaState, activeDevice, probed) {
    this.opts = opts;
    this.diffusion = diffusion;
    this.mambaState = mambaState;
    this.activeDevice = activeDevice;
    this.probed = probed;
  }
  opts;
  diffusion;
  mambaState;
  activeDevice;
  /** Track the probed device so we can lazy-create a refinement-pass engine
   *  later with the same hardware target — needed for the two-pass quality
   *  chain (draft model → dispose → refinement model). */
  probed;
  /**
   * Construct an engine bound to the host's best available hardware. Returns
   * `null` when no device path is viable — the consumer should render an
   * unsupported state rather than try to recover.
   */
  static async create(options) {
    reportProgress(`Probing hardware (target: ${options.device ?? "auto"})\u2026`, options.onProgress);
    const probed = await probeDevice(options.device ?? "auto");
    if (!probed) return null;
    reportProgress(`Hardware ready: ${probed.label} (${probed.kind}).`, options.onProgress);
    const width = options.width ?? DEFAULT_WIDTH;
    const height = options.height ?? DEFAULT_HEIGHT;
    const weightSources = options.weightSources ?? DEFAULT_WEIGHT_SOURCES;
    const diffusion = new DiffusionEngine({
      model: options.model,
      probed,
      apiKey: options.apiKey,
      weightSources,
      r2Base: deriveR2Base(options.baseUrl),
      width,
      height,
      onProgress: options.onProgress
    });
    await diffusion.init();
    const state = options.mambaState ?? emptyState({ dim: 64, order: 4, channels: 16 });
    return new _VideoEngine(
      { ...options, weightSources, width, height },
      diffusion,
      state,
      probed.kind,
      probed
    );
  }
  /**
   * Generate one video clip. Per-keyframe work is sequential (keyframes depend
   * on the previous keyframe's Mamba state). With `interpolationFactor > 1`,
   * only keyframes run the diffusion denoise loop and the frames between them
   * are slerp-interpolated in latent space (one cheap VAE decode each). Returns
   * the muxed MP4 plus the updated state.
   */
  async generate(args) {
    const start = performance.now();
    const descriptor = MODEL_REGISTRY[this.opts.model];
    const steps = args.steps ?? descriptor.defaultSteps;
    const guidance = args.guidance ?? descriptor.defaultGuidance;
    const coherenceMode = args.coherence ?? DEFAULT_COHERENCE;
    const coherenceStrength = args.coherenceStrength ?? DEFAULT_COHERENCE_STRENGTH;
    const seed = args.seed ?? Date.now();
    const width = this.opts.width ?? DEFAULT_WIDTH;
    const height = this.opts.height ?? DEFAULT_HEIGHT;
    const onProgress = args.onProgress;
    if (!args.skipPromptExpansion) {
      reportProgress("Expanding prompt via Builderforce LLM gateway\u2026", onProgress);
    }
    const resolvedPrompt = args.skipPromptExpansion ? args.prompt : await expandPrompt({
      apiKey: this.opts.apiKey,
      baseUrl: this.opts.baseUrl,
      promptModel: this.opts.promptModel,
      prompt: args.prompt,
      signal: args.signal
    });
    args.onPromptExpanded?.(resolvedPrompt);
    reportProgress("Encoding prompt with CLIP text encoder\u2026", onProgress);
    const promptEmbedding = await this.diffusion.embedPrompt(resolvedPrompt);
    const negativeEmbedding = args.negativePrompt ? await this.diffusion.embedPrompt(args.negativePrompt) : null;
    const clip = await this.produceClip({
      frameCount: args.frames,
      promptEmbedding,
      negativeEmbedding,
      timesteps: trimTimesteps(descriptor.defaultTimesteps, steps),
      guidance,
      coherenceMode,
      coherenceStrength,
      seed,
      motionAmount: clamp012(args.motionAmount ?? DEFAULT_MOTION_AMOUNT),
      imgToImgStrength: clamp012(args.imgToImgStrength ?? 0),
      cameraMotion: args.cameraMotion,
      interpolationFactor: normaliseFactor(args.interpolationFactor),
      interpolationBackend: args.interpolationBackend ?? "latent-slerp",
      width,
      height,
      label: "Frame",
      frameOffset: 0,
      onProgress,
      onFrame: args.onFrame,
      signal: args.signal
    });
    let refined = null;
    if (this.opts.refinementModel && this.opts.refinementModel !== this.opts.model) {
      refined = await this.refinementPass(clip, {
        resolvedPrompt,
        seed,
        width,
        height,
        refinementStrength: clamp012(args.refinementStrength ?? DEFAULT_REFINEMENT_STRENGTH),
        onProgress,
        onFrame: args.onFrame,
        signal: args.signal
      });
    }
    const finalFrames = refined?.frames ?? clip.frames;
    const finalMuxFrames = refined?.muxFrames ?? clip.muxFrames;
    reportProgress(`Encoding ${finalFrames.length} frames to MP4\u2026`, onProgress);
    const blob = await muxFramesToMp4(finalMuxFrames, {
      width,
      height,
      fps: args.fps,
      signal: args.signal
    });
    reportProgress("MP4 ready.", onProgress);
    return {
      blob,
      mambaState: this.mambaState,
      frames: finalFrames,
      activeDevice: this.activeDevice,
      resolvedPrompt,
      elapsedMs: performance.now() - start
    };
  }
  /**
   * Render a full storyboard (the Director / Shot-Planner output) into one MP4.
   * Each shot is generated as its own clip — the shot's composed prompt (shot
   * text + locked character appearances) is embedded fresh, the camera move is
   * mapped to latent motion + img2img recursion, and the Mamba state is carried
   * ACROSS shots so the SSM memory threads continuity through the whole scene.
   * When `validate` is set, each shot's first keyframe is checked by the VLM
   * frame validator (advisory — never blocks generation).
   */
  async generateStoryboard(args) {
    const start = performance.now();
    const descriptor = MODEL_REGISTRY[this.opts.model];
    const steps = args.steps ?? descriptor.defaultSteps;
    const guidance = args.guidance ?? descriptor.defaultGuidance;
    const coherenceMode = args.coherence ?? DEFAULT_COHERENCE;
    const coherenceStrength = args.coherenceStrength ?? DEFAULT_COHERENCE_STRENGTH;
    const seedBase = args.seed ?? Date.now();
    const width = this.opts.width ?? DEFAULT_WIDTH;
    const height = this.opts.height ?? DEFAULT_HEIGHT;
    const onProgress = args.onProgress;
    const interpolationFactor = normaliseFactor(args.interpolationFactor);
    const timesteps = trimTimesteps(descriptor.defaultTimesteps, steps);
    const { storyboard } = args;
    const allFrames = [];
    const allMuxFrames = [];
    let allLatents = [];
    const validations = [];
    const maxRetries = args.validate ? Math.max(0, Math.floor(args.maxValidationRetries ?? 1)) : 0;
    let globalIdx = 0;
    for (let s = 0; s < storyboard.shots.length; s++) {
      if (args.signal?.aborted) throw new DOMException("Generation aborted", "AbortError");
      const shot = storyboard.shots[s];
      const shotPrompt = composeShotPrompt(shot, storyboard.characters);
      reportProgress(
        `Shot ${s + 1}/${storyboard.shots.length} (${shot.camera}, ${shot.durationFrames}f): ${shotPrompt}`,
        onProgress
      );
      const shotEmbedding = await this.diffusion.embedPrompt(shotPrompt);
      const { clip, validation } = await this.renderShot({
        shot,
        characters: storyboard.characters,
        shotEmbedding,
        shotIndex: s,
        shotCount: storyboard.shots.length,
        baseSeed: seedBase + s * 100003,
        timesteps,
        guidance,
        coherenceMode,
        coherenceStrength,
        motionAmount: clamp012(args.motionAmount ?? DEFAULT_MOTION_AMOUNT),
        interpolationFactor,
        interpolationBackend: args.interpolationBackend ?? "latent-slerp",
        width,
        height,
        frameOffset: globalIdx,
        validate: Boolean(args.validate),
        validatorModel: args.validatorModel,
        passThreshold: args.passThreshold,
        maxRetries,
        onProgress,
        onFrame: args.onFrame,
        signal: args.signal
      });
      if (validation) {
        validations.push({ shotId: shot.id, frameIndex: globalIdx, validation });
      }
      allFrames.push(...clip.frames);
      allMuxFrames.push(...clip.muxFrames);
      allLatents.push(...clip.latents);
      globalIdx += clip.frames.length;
      args.onShot?.(s, shot, validation);
    }
    let finalFrames = allFrames;
    let finalMuxFrames = allMuxFrames;
    if (this.opts.refinementModel && this.opts.refinementModel !== this.opts.model) {
      const refined = await this.refinementPass(
        { frames: allFrames, muxFrames: allMuxFrames, latents: allLatents },
        {
          resolvedPrompt: storyboard.treatment,
          seed: seedBase,
          width,
          height,
          refinementStrength: clamp012(DEFAULT_REFINEMENT_STRENGTH),
          onProgress,
          onFrame: args.onFrame,
          signal: args.signal
        }
      );
      finalFrames = refined.frames;
      finalMuxFrames = refined.muxFrames;
      allLatents = refined.latents;
    }
    reportProgress(`Encoding ${finalFrames.length} frames to MP4\u2026`, onProgress);
    const blob = await muxFramesToMp4(finalMuxFrames, {
      width,
      height,
      fps: args.fps,
      signal: args.signal
    });
    reportProgress("MP4 ready.", onProgress);
    return {
      blob,
      mambaState: this.mambaState,
      frames: finalFrames,
      activeDevice: this.activeDevice,
      storyboard,
      validations,
      elapsedMs: performance.now() - start
    };
  }
  /**
   * Render one storyboard shot, with self-healing validation retries. Generates
   * the clip, validates its first + last keyframe, and — if validation fails and
   * retries remain — re-renders with a fresh seed, keeping the highest-scoring
   * attempt. The Mamba state is snapshotted before each attempt and restored, so
   * a discarded attempt doesn't pollute cross-shot continuity; the kept
   * attempt's state is committed on return.
   */
  async renderShot(args) {
    const motion = cameraMoveToMotion(args.shot.camera);
    const stateBefore = this.mambaState;
    let best = null;
    for (let attempt = 0; attempt <= args.maxRetries; attempt++) {
      if (args.signal?.aborted) throw new DOMException("Generation aborted", "AbortError");
      this.mambaState = stateBefore;
      if (attempt > 0) {
        reportProgress(
          `Shot ${args.shotIndex + 1}/${args.shotCount}: validation retry ${attempt}/${args.maxRetries}\u2026`,
          args.onProgress
        );
      }
      const clip = await this.produceClip({
        frameCount: args.shot.durationFrames,
        promptEmbedding: args.shotEmbedding,
        negativeEmbedding: null,
        timesteps: args.timesteps,
        guidance: args.guidance,
        coherenceMode: args.coherenceMode,
        coherenceStrength: args.coherenceStrength,
        seed: args.baseSeed + attempt * 7919,
        motionAmount: args.motionAmount,
        imgToImgStrength: motion.imgToImgStrength,
        cameraMotion: motion.cameraMotion,
        interpolationFactor: args.interpolationFactor,
        interpolationBackend: args.interpolationBackend,
        width: args.width,
        height: args.height,
        label: `Shot ${args.shotIndex + 1}`,
        frameOffset: args.frameOffset,
        onProgress: args.onProgress,
        onFrame: args.onFrame,
        signal: args.signal
      });
      const validation = args.validate ? await this.validateShot(clip, {
        shot: args.shot,
        characters: args.characters,
        width: args.width,
        height: args.height,
        validatorModel: args.validatorModel,
        passThreshold: args.passThreshold,
        signal: args.signal,
        onProgress: args.onProgress
      }) : null;
      const score = validation?.score ?? 1;
      const prevBestScore = best?.validation?.score ?? -1;
      if (!best || score > prevBestScore) {
        if (best) closeClip(best.clip);
        best = { clip, validation, state: this.mambaState };
      } else {
        closeClip(clip);
      }
      if (!validation || validation.ok) break;
    }
    this.mambaState = best.state;
    return { clip: best.clip, validation: best.validation };
  }
  /**
   * Generate the frames for one clip. Keyframes (every `interpolationFactor`-th
   * output frame, with index 0 and the last index pinned) run the full denoise
   * loop; the frames between them are slerp-interpolated in latent space and
   * decoded once each. Advances `this.mambaState` per keyframe. Returns frames
   * in OUTPUT ORDER plus each frame's clean latent (for the refinement pass).
   *
   * Encapsulates the anchor-walk / img2img-recursion / camera-motion / Mamba
   * logic shared by `generate` and `generateStoryboard` — single source of
   * truth for "how one frame is made".
   */
  async produceClip(spec) {
    const {
      frameCount,
      promptEmbedding,
      negativeEmbedding,
      timesteps,
      guidance,
      coherenceMode,
      coherenceStrength,
      seed,
      motionAmount,
      imgToImgStrength,
      cameraMotion,
      interpolationFactor,
      interpolationBackend,
      width,
      height,
      label,
      frameOffset,
      onProgress,
      onFrame,
      signal
    } = spec;
    const descriptor = MODEL_REGISTRY[this.opts.model];
    const latentH = height / 8;
    const latentW = width / 8;
    const anchorLatent = this.diffusion.sampleInitialLatent(seed);
    const walkStart = this.diffusion.sampleInitialLatent(seed + 1);
    const walkEnd = this.diffusion.sampleInitialLatent(seed + 2);
    const keyframeIndices = planKeyframeIndices(frameCount, interpolationFactor);
    let prevLatent = null;
    const keyframes = [];
    const keyframeOutputs = [];
    for (let k = 0; k < keyframeIndices.length; k++) {
      if (signal?.aborted) throw new DOMException("Generation aborted", "AbortError");
      const frameIdx = keyframeIndices[k];
      const conditionedPrompt = coherenceMode === "prompt-bias" ? applyToPrompt({
        ctx: { mode: coherenceMode, strength: coherenceStrength, state: this.mambaState },
        promptEmbedding,
        seqLen: descriptor.sequenceLength,
        embedDim: descriptor.textEmbedDim
      }) : promptEmbedding;
      const useImg2Img = imgToImgStrength > 0 && prevLatent !== null;
      let latent;
      let frameTimesteps;
      if (useImg2Img) {
        let transformed = prevLatent;
        const latentShape = { channels: 4, height: latentH, width: latentW };
        if (cameraMotion && (cameraMotion.dx !== 0 || cameraMotion.dy !== 0)) {
          transformed = shiftLatent(transformed, latentShape, cameraMotion.dx, cameraMotion.dy);
        }
        if (cameraMotion?.zoom && cameraMotion.zoom !== 1) {
          transformed = scaleLatent(transformed, latentShape, cameraMotion.zoom);
        }
        const shifted = transformed;
        const skipCount = Math.floor(timesteps.length * (1 - imgToImgStrength));
        const truncated = timesteps.slice(skipCount);
        frameTimesteps = truncated.length > 0 ? truncated : [timesteps[timesteps.length - 1]];
        latent = this.diffusion.addNoiseToLatent(shifted, frameTimesteps[0], seed + frameIdx);
      } else {
        latent = anchorWalkLatent(anchorLatent, walkStart, walkEnd, frameIdx, frameCount, motionAmount);
        frameTimesteps = timesteps;
      }
      if (shouldApplyLatentResidualBias(coherenceMode, useImg2Img)) {
        latent = applyToLatent({
          ctx: { mode: coherenceMode, strength: coherenceStrength, state: this.mambaState },
          latent
        });
      }
      reportProgress(
        `${label} ${frameIdx + 1}/${frameCount} (keyframe ${k + 1}/${keyframeIndices.length}): ${useImg2Img ? `img2img (${frameTimesteps.length}/${timesteps.length} steps)` : "denoising"}\u2026`,
        onProgress
      );
      const { pixels, latent: finalLatent } = await this.diffusion.denoise({
        latent,
        condEmbedding: conditionedPrompt,
        uncondEmbedding: negativeEmbedding,
        timesteps: frameTimesteps,
        guidance,
        seed: seed + frameIdx,
        onStep: (step, total) => reportProgress(`${label} ${frameIdx + 1}/${frameCount}: denoise step ${step}/${total}\u2026`, onProgress)
      });
      prevLatent = finalLatent;
      const rgba = pixelsToRgba(pixels, width, height);
      const bitmap = await createImageBitmap(
        new ImageData(rgba, width, height)
      );
      this.mambaState = advanceState(this.mambaState, pixels);
      keyframes.push({ outputIndex: frameIdx, latent: finalLatent });
      keyframeOutputs.push({ rgba, bitmap, pixels });
      onFrame?.(frameOffset + frameIdx, bitmap, this.mambaState);
    }
    const slots = buildInterpolatedSequence(keyframes);
    const frames = new Array(frameCount);
    const muxFrames = new Array(frameCount);
    const latents = new Array(frameCount);
    const useMotion = interpolationBackend === "motion" && keyframes.length > 1;
    const motionFields = /* @__PURE__ */ new Map();
    let leftKi = 0;
    for (const slot of slots) {
      if (signal?.aborted) throw new DOMException("Generation aborted", "AbortError");
      if (!slot.isTween) {
        const ki = slot.keyframeIndex;
        leftKi = ki;
        frames[slot.outputIndex] = keyframeOutputs[ki].bitmap;
        muxFrames[slot.outputIndex] = { rgba: keyframeOutputs[ki].rgba };
        latents[slot.outputIndex] = keyframes[ki].latent;
        continue;
      }
      let pixels;
      if (useMotion && leftKi + 1 < keyframes.length) {
        const k0 = keyframes[leftKi];
        const k1 = keyframes[leftKi + 1];
        const span = k1.outputIndex - k0.outputIndex;
        const t = span > 0 ? (slot.outputIndex - k0.outputIndex) / span : 0.5;
        reportProgress(`${label} ${slot.outputIndex + 1}/${frameCount}: motion-warp\u2026`, onProgress);
        let field = motionFields.get(leftKi);
        if (!field) {
          field = estimateBlockMotion(
            keyframeOutputs[leftKi].pixels,
            keyframeOutputs[leftKi + 1].pixels,
            width,
            height
          );
          motionFields.set(leftKi, field);
        }
        pixels = interpolateFrames(
          keyframeOutputs[leftKi].pixels,
          keyframeOutputs[leftKi + 1].pixels,
          width,
          height,
          t,
          field
        );
        latents[slot.outputIndex] = null;
      } else {
        reportProgress(`${label} ${slot.outputIndex + 1}/${frameCount}: interpolating\u2026`, onProgress);
        pixels = await this.diffusion.decodeLatent(slot.latent);
        latents[slot.outputIndex] = slot.latent;
      }
      const rgba = pixelsToRgba(pixels, width, height);
      const bitmap = await createImageBitmap(
        new ImageData(rgba, width, height)
      );
      frames[slot.outputIndex] = bitmap;
      muxFrames[slot.outputIndex] = { rgba };
      onFrame?.(frameOffset + slot.outputIndex, bitmap, this.mambaState);
    }
    return { frames, muxFrames, latents };
  }
  /**
   * Second pass over an already-produced clip through a different (usually
   * larger) model. Disposes the draft engine, loads the refinement engine, and
   * for each frame WITH a true latent re-noises it to a partial timestep and
   * finishes the denoise. Frames with a `null` latent (motion-backend tweens)
   * are carried through UNCHANGED — refining them from a stand-in latent would
   * discard their optical-flow warp. Sequential load → VRAM stays at
   * max(draft, refinement). Only safe across SD1.5-family models.
   *
   * Owns the lifecycle of the draft clip's bitmaps: refined frames replace and
   * CLOSE their drafts; carried-through frames are reused (not closed). The
   * caller must NOT close the draft clip afterwards.
   */
  async refinementPass(clip, opts) {
    const { onProgress } = opts;
    const { latents } = clip;
    reportProgress(
      `Refinement pass: swapping ${this.opts.model} \u2192 ${this.opts.refinementModel} (sequential, no VRAM cost)\u2026`,
      onProgress
    );
    await this.diffusion.dispose();
    this.diffusion = new DiffusionEngine({
      model: this.opts.refinementModel,
      probed: this.probed,
      apiKey: this.opts.apiKey,
      weightSources: this.opts.weightSources ?? DEFAULT_WEIGHT_SOURCES,
      r2Base: deriveR2Base(this.opts.baseUrl),
      width: opts.width,
      height: opts.height,
      onProgress
    });
    await this.diffusion.init();
    const refinedCondEmbedding = await this.diffusion.embedPrompt(opts.resolvedPrompt);
    const refinedDescriptor = MODEL_REGISTRY[this.opts.refinementModel];
    const refinedTimesteps = trimTimesteps(refinedDescriptor.defaultTimesteps, refinedDescriptor.defaultSteps);
    const skipCount = Math.floor(refinedTimesteps.length * (1 - opts.refinementStrength));
    const partialTimesteps = skipCount < refinedTimesteps.length ? refinedTimesteps.slice(skipCount) : [refinedTimesteps[refinedTimesteps.length - 1]];
    const frames = new Array(latents.length);
    const muxFrames = new Array(latents.length);
    const outLatents = new Array(latents.length);
    let refinedCount = 0;
    for (let i = 0; i < latents.length; i++) {
      if (opts.signal?.aborted) throw new DOMException("Generation aborted", "AbortError");
      const latent = latents[i];
      if (latent === null) {
        frames[i] = clip.frames[i];
        muxFrames[i] = clip.muxFrames[i];
        outLatents[i] = null;
        continue;
      }
      reportProgress(`Refinement pass: frame ${i + 1}/${latents.length}\u2026`, onProgress);
      const noised = this.diffusion.addNoiseToLatent(latent, partialTimesteps[0], opts.seed + i);
      const { pixels, latent: refinedLatent } = await this.diffusion.denoise({
        latent: noised,
        condEmbedding: refinedCondEmbedding,
        uncondEmbedding: null,
        timesteps: partialTimesteps,
        guidance: refinedDescriptor.defaultGuidance,
        seed: opts.seed + i
      });
      const rgba = pixelsToRgba(pixels, opts.width, opts.height);
      const bitmap = await createImageBitmap(
        new ImageData(rgba, opts.width, opts.height)
      );
      try {
        clip.frames[i].close();
      } catch {
      }
      frames[i] = bitmap;
      muxFrames[i] = { rgba };
      outLatents[i] = refinedLatent;
      refinedCount++;
      opts.onFrame?.(i, bitmap, this.mambaState);
    }
    reportProgress(`Refinement pass complete (${refinedCount}/${latents.length} frames refined).`, onProgress);
    return { frames, muxFrames, latents: outLatents };
  }
  /**
   * Validate a shot through the VLM by checking its FIRST and LAST keyframe
   * (mid-shot drift is invisible to a single-frame check). Returns the merged
   * verdict: `ok` only if both ends pass, `score` is the worse of the two, and
   * issues are concatenated. Returns null when validation can't run at all (no
   * OffscreenCanvas / both calls failed) so the caller treats it as advisory.
   */
  async validateShot(clip, ctx) {
    if (clip.muxFrames.length === 0) return null;
    const lastIdx = clip.muxFrames.length - 1;
    const indices = lastIdx === 0 ? [0] : [0, lastIdx];
    const verdicts = (await Promise.all(
      indices.map(
        (i) => this.validateOneFrame(clip.muxFrames[i], `frame ${i + 1}`, ctx)
      )
    )).filter((v) => v !== null);
    if (verdicts.length === 0) return null;
    return {
      ok: verdicts.every((v) => v.ok),
      score: Math.min(...verdicts.map((v) => v.score)),
      issues: verdicts.flatMap((v) => v.issues)
    };
  }
  /**
   * Validate ONE frame of a shot through the VLM. Encodes the raw RGBA to a
   * JPEG data URL (via OffscreenCanvas) and asks the gateway's vision model
   * whether it matches the shot + character bible. Advisory: any failure
   * (no OffscreenCanvas, gateway down) returns null.
   */
  async validateOneFrame(frame, frameLabel, ctx) {
    try {
      reportProgress(`Validating shot "${ctx.shot.id}" ${frameLabel} via VLM\u2026`, ctx.onProgress);
      const dataUrl = await rgbaToDataUrl(frame.rgba, ctx.width, ctx.height);
      if (!dataUrl) return null;
      const present = ctx.shot.characterIds.map((id) => ctx.characters.find((c) => c.id === id)).filter((c) => Boolean(c)).map((c) => ({ name: c.name, appearance: c.appearance }));
      return await validateFrame({
        apiKey: this.opts.apiKey,
        baseUrl: this.opts.baseUrl,
        validatorModel: ctx.validatorModel,
        frameDataUrl: dataUrl,
        shotDescription: `${ctx.shot.prompt} \u2014 action: ${ctx.shot.action}`,
        characters: present,
        passThreshold: ctx.passThreshold,
        signal: ctx.signal
      });
    } catch {
      return null;
    }
  }
  /** Read the current Mamba state without mutating the engine — for persistence. */
  getMambaState() {
    return this.mambaState;
  }
  /** Replace the Mamba state — used when resuming a session from R2 / IDB. */
  setMambaState(state) {
    this.mambaState = state;
  }
  /** Release ORT sessions + GPUDevice. Idempotent. After dispose the engine
   *  cannot be reused — create a new one with VideoEngine.create. */
  async dispose() {
    await this.diffusion.dispose();
  }
};
function clamp012(x) {
  if (!Number.isFinite(x)) return DEFAULT_MOTION_AMOUNT;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
function closeClip(clip) {
  for (const bm of clip.frames) {
    try {
      bm.close();
    } catch {
    }
  }
}
function normaliseFactor(factor) {
  if (factor === void 0 || !Number.isFinite(factor)) return 1;
  return Math.max(1, Math.floor(factor));
}
async function rgbaToDataUrl(rgba, width, height) {
  if (typeof OffscreenCanvas === "undefined") return null;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
function deriveR2Base(baseUrl) {
  if (!baseUrl) return void 0;
  return `${baseUrl.replace(/\/$/, "")}/api/studio/weights`;
}
function trimTimesteps(defaults, steps) {
  if (steps >= defaults.length) return defaults;
  if (steps <= 1) return [defaults[0]];
  const out = [];
  for (let i = 0; i < steps; i++) {
    const idx = Math.round(i * (defaults.length - 1) / (steps - 1));
    out.push(defaults[idx]);
  }
  return out;
}

// src/engine/voice/audio-frames.ts
var DEFAULT_SAMPLE_RATE = 24e3;
var DEFAULT_FRAME_LENGTH = 1024;
var DEFAULT_HOP_LENGTH = 256;
var DEFAULT_NUM_MELS = 80;
function defaultMelConfig(overrides = {}) {
  return {
    sampleRate: overrides.sampleRate ?? DEFAULT_SAMPLE_RATE,
    frameLength: overrides.frameLength ?? DEFAULT_FRAME_LENGTH,
    hopLength: overrides.hopLength ?? DEFAULT_HOP_LENGTH,
    numMels: overrides.numMels ?? DEFAULT_NUM_MELS
  };
}
var hannCache = /* @__PURE__ */ new Map();
function hannWindow(n) {
  const cached = hannCache.get(n);
  if (cached) return cached;
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  }
  hannCache.set(n, w);
  return w;
}
function frameSignal(signal, frameLength, hopLength) {
  if (signal.length === 0) return [];
  const frames = [];
  for (let start = 0; start < signal.length; start += hopLength) {
    const frame = new Float32Array(frameLength);
    const end = Math.min(start + frameLength, signal.length);
    frame.set(signal.subarray(start, end));
    frames.push(frame);
    if (end >= signal.length) break;
  }
  return frames;
}
function fftInPlace(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if ((n & n - 1) !== 0) {
    throw new Error(`fftInPlace: length ${n} is not a power of two`);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len >> 1; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + (len >> 1)] * curRe - im[i + k + (len >> 1)] * curIm;
        const bIm = re[i + k + (len >> 1)] * curIm + im[i + k + (len >> 1)] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + (len >> 1)] = aRe - bRe;
        im[i + k + (len >> 1)] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}
function ifftInPlace(re, im) {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fftInPlace(re, im);
  const inv = 1 / n;
  for (let i = 0; i < n; i++) {
    re[i] *= inv;
    im[i] = -im[i] * inv;
  }
}
function magnitudeSpectrum(frame) {
  const n = frame.length;
  const re = new Float32Array(frame);
  const im = new Float32Array(n);
  fftInPlace(re, im);
  const bins = n / 2 + 1;
  const mag = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    mag[b] = Math.hypot(re[b], im[b]);
  }
  return mag;
}
var hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
var melToHz = (mel) => 700 * (10 ** (mel / 2595) - 1);
var filterbankCache = /* @__PURE__ */ new Map();
function melFilterbank(config) {
  const key = `${config.sampleRate}:${config.frameLength}:${config.numMels}`;
  const cached = filterbankCache.get(key);
  if (cached) return cached;
  const bins = config.frameLength / 2 + 1;
  const melMin = hzToMel(0);
  const melMax = hzToMel(config.sampleRate / 2);
  const points = new Float32Array(config.numMels + 2);
  for (let i = 0; i < points.length; i++) {
    const mel = melMin + (melMax - melMin) * i / (config.numMels + 1);
    points[i] = melToHz(mel) / (config.sampleRate / 2) * (bins - 1);
  }
  const filters = [];
  for (let m = 1; m <= config.numMels; m++) {
    const row = new Float32Array(bins);
    const left = points[m - 1];
    const center = points[m];
    const right = points[m + 1];
    for (let b = 0; b < bins; b++) {
      let w = 0;
      if (b >= left && b <= center && center > left) w = (b - left) / (center - left);
      else if (b > center && b <= right && right > center) w = (right - b) / (right - center);
      row[b] = w;
    }
    filters.push(row);
  }
  filterbankCache.set(key, filters);
  return filters;
}
var LOG_FLOOR = 1e-5;
function melSpectrogram(pcm, overrides = {}) {
  const config = defaultMelConfig(overrides);
  const window = hannWindow(config.frameLength);
  const filters = melFilterbank(config);
  const frames = frameSignal(pcm, config.frameLength, config.hopLength);
  const melFrames = frames.map((frame) => {
    const windowed = new Float32Array(config.frameLength);
    for (let i = 0; i < config.frameLength; i++) windowed[i] = frame[i] * window[i];
    const mag = magnitudeSpectrum(windowed);
    const mel = new Float32Array(config.numMels);
    for (let m = 0; m < config.numMels; m++) {
      const row = filters[m];
      let energy = 0;
      for (let b = 0; b < row.length; b++) energy += row[b] * mag[b];
      mel[m] = Math.log(Math.max(energy, LOG_FLOOR));
    }
    return mel;
  });
  return {
    frames: melFrames,
    numMels: config.numMels,
    hopLength: config.hopLength,
    frameLength: config.frameLength,
    sampleRate: config.sampleRate
  };
}
function melToWaveform(mel) {
  const { frames, hopLength, frameLength, numMels, sampleRate } = mel;
  if (frames.length === 0) return new Float32Array(0);
  const filters = melFilterbank({ sampleRate, frameLength, hopLength, numMels });
  const window = hannWindow(frameLength);
  const bins = frameLength / 2 + 1;
  const binWeight = new Float32Array(bins);
  for (let m = 0; m < numMels; m++) {
    const row = filters[m];
    for (let b = 0; b < bins; b++) binWeight[b] += row[b];
  }
  const outLength = (frames.length - 1) * hopLength + frameLength;
  const out = new Float32Array(outLength);
  const norm = new Float32Array(outLength);
  for (let f = 0; f < frames.length; f++) {
    const melVec = frames[f];
    const mag = new Float32Array(bins);
    for (let m = 0; m < numMels; m++) {
      const energy = Math.exp(melVec[m]);
      const row = filters[m];
      for (let b = 0; b < bins; b++) mag[b] += row[b] * energy;
    }
    for (let b = 0; b < bins; b++) {
      if (binWeight[b] > 0) mag[b] /= binWeight[b];
    }
    const re = new Float32Array(frameLength);
    const im = new Float32Array(frameLength);
    for (let b = 0; b < bins; b++) {
      re[b] = mag[b];
      if (b > 0 && b < bins - 1) re[frameLength - b] = mag[b];
    }
    ifftInPlace(re, im);
    const base = f * hopLength;
    for (let i = 0; i < frameLength; i++) {
      out[base + i] += re[i] * window[i];
      norm[base + i] += window[i] * window[i];
    }
  }
  for (let i = 0; i < outLength; i++) {
    if (norm[i] > 1e-8) out[i] /= norm[i];
  }
  return out;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function l2Normalize(v) {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

// src/engine/voice/speaker-encoder.ts
var DEFAULT_EMBEDDING_DIM = 256;
function encodeSpeaker(reference, options = {}) {
  const embeddingDim = options.embeddingDim ?? DEFAULT_EMBEDDING_DIM;
  const sampleRate = options.sampleRate ?? reference.sampleRate;
  const numMels = options.numMels;
  const mel = melSpectrogram(reference.samples, { sampleRate, ...numMels ? { numMels } : {} });
  if (mel.frames.length === 0) {
    return { data: new Array(embeddingDim).fill(0), dim: embeddingDim, sampleRate };
  }
  const m = mel.numMels;
  const mean = new Float32Array(m);
  for (const frame of mel.frames) {
    for (let i = 0; i < m; i++) mean[i] += frame[i];
  }
  for (let i = 0; i < m; i++) mean[i] /= mel.frames.length;
  const std = new Float32Array(m);
  for (const frame of mel.frames) {
    for (let i = 0; i < m; i++) {
      const d = frame[i] - mean[i];
      std[i] += d * d;
    }
  }
  for (let i = 0; i < m; i++) std[i] = Math.sqrt(std[i] / mel.frames.length);
  const stats = new Float32Array(2 * m);
  stats.set(mean, 0);
  stats.set(std, m);
  const projected = projectStats(stats, embeddingDim);
  l2Normalize(projected);
  return { data: Array.from(projected), dim: embeddingDim, sampleRate };
}
var projectionCache = /* @__PURE__ */ new Map();
function projectStats(stats, outDim) {
  const inDim = stats.length;
  const key = `${inDim}:${outDim}`;
  let signs = projectionCache.get(key);
  if (!signs) {
    signs = new Int8Array(inDim * outDim);
    const rand = mulberry32((2654435769 ^ Math.imul(inDim, 2654435761) ^ outDim) >>> 0);
    for (let i = 0; i < signs.length; i++) signs[i] = rand() < 0.5 ? -1 : 1;
    projectionCache.set(key, signs);
  }
  const out = new Float32Array(outDim);
  const scale = 1 / Math.sqrt(inDim);
  for (let o = 0; o < outDim; o++) {
    let sum = 0;
    const base = o * inDim;
    for (let i = 0; i < inDim; i++) sum += signs[base + i] * stats[i];
    out[o] = sum * scale;
  }
  return out;
}
function verifySpeaker(a, b, threshold = 0.75) {
  const similarity = cosineSimilarity(a.data, b.data);
  return { same: similarity >= threshold, similarity };
}

// src/engine/voice/neural-codec.ts
var DEFAULT_NUM_QUANTIZERS = 4;
var DEFAULT_CODEBOOK_SIZE = 256;
var NeuralCodec = class {
  config;
  numQuantizers;
  codebookSize;
  /** `[quantizer][entry] = mel-dim centroid`. */
  codebooks;
  constructor(options = {}) {
    this.config = defaultMelConfig({
      ...options.sampleRate ? { sampleRate: options.sampleRate } : {},
      ...options.numMels ? { numMels: options.numMels } : {},
      ...options.frameLength ? { frameLength: options.frameLength } : {},
      ...options.hopLength ? { hopLength: options.hopLength } : {}
    });
    this.numQuantizers = options.numQuantizers ?? DEFAULT_NUM_QUANTIZERS;
    this.codebookSize = options.codebookSize ?? DEFAULT_CODEBOOK_SIZE;
    this.codebooks = options.codebooks ?? buildSeededCodebooks(this.numQuantizers, this.codebookSize, this.config.numMels);
    if (this.codebooks.length !== this.numQuantizers) {
      throw new Error(
        `NeuralCodec: ${this.codebooks.length} codebooks for ${this.numQuantizers} quantizers`
      );
    }
  }
  get quantizers() {
    return this.numQuantizers;
  }
  get vocabSize() {
    return this.codebookSize;
  }
  get sampleRate() {
    return this.config.sampleRate;
  }
  /** PCM ▶ discrete tokens. */
  encode(audio) {
    const mel = melSpectrogram(audio.samples, this.config);
    return this.encodeMel(mel);
  }
  /** log-mel spectrogram ▶ discrete tokens. The acoustic model and the analysis
   *  path share this so quantisation lives in one place. */
  encodeMel(mel) {
    const tokens = mel.frames.map((frame) => {
      const residual = new Float32Array(frame);
      const ids = [];
      for (let q = 0; q < this.numQuantizers; q++) {
        const id = nearestCentroid(this.codebooks[q], residual);
        ids.push(id);
        const centroid = this.codebooks[q][id];
        for (let i = 0; i < residual.length; i++) residual[i] -= centroid[i];
      }
      return ids;
    });
    return {
      tokens,
      numFrames: tokens.length,
      numQuantizers: this.numQuantizers,
      codebookSize: this.codebookSize,
      hopLength: this.config.hopLength,
      frameLength: this.config.frameLength,
      sampleRate: this.config.sampleRate
    };
  }
  /** Discrete tokens ▶ reconstructed log-mel spectrogram (sum of chosen
   *  centroids per frame). */
  decodeMel(codec) {
    const frames = codec.tokens.map((ids) => {
      const mel = new Float32Array(this.config.numMels);
      for (let q = 0; q < ids.length && q < this.numQuantizers; q++) {
        const centroid = this.codebooks[q][ids[q]];
        for (let i = 0; i < mel.length; i++) mel[i] += centroid[i];
      }
      return mel;
    });
    return {
      frames,
      numMels: this.config.numMels,
      hopLength: codec.hopLength,
      frameLength: codec.frameLength,
      sampleRate: codec.sampleRate
    };
  }
  /** Discrete tokens ▶ PCM waveform (mel reconstruction → shared vocoder). */
  decode(codec) {
    const mel = this.decodeMel(codec);
    const samples = melToWaveform(mel);
    return { samples, sampleRate: codec.sampleRate };
  }
};
function nearestCentroid(codebook, vec) {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < codebook.length; i++) {
    const score = cosineSimilarity(codebook[i], vec);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
function buildSeededCodebooks(numQuantizers, codebookSize, melDim) {
  const books = [];
  for (let q = 0; q < numQuantizers; q++) {
    const rand = mulberry32((49374 ^ Math.imul(q + 1, 2246822519)) >>> 0);
    const scale = 0.5 ** q;
    const book = [];
    for (let e = 0; e < codebookSize; e++) {
      const centroid = new Float32Array(melDim);
      for (let i = 0; i < melDim; i++) centroid[i] = (rand() * 2 - 1) * scale;
      book.push(centroid);
    }
    books.push(book);
  }
  return books;
}

// src/engine/voice/text-tokenizer.ts
var ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 .,!?'-";
var CHAR_TO_ID = /* @__PURE__ */ new Map();
for (let i = 0; i < ALPHABET.length; i++) CHAR_TO_ID.set(ALPHABET[i], i + 1);
var TEXT_VOCAB_SIZE = ALPHABET.length + 1;
function tokenizeText(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = [];
  for (const ch of normalized) tokens.push(CHAR_TO_ID.get(ch) ?? 0);
  const words = [];
  let cursor = 0;
  for (const word of normalized.split(" ")) {
    if (word.length === 0) continue;
    const startChar = normalized.indexOf(word, cursor);
    const endChar = startChar + word.length;
    words.push({ word, startChar, endChar });
    cursor = endChar;
  }
  return { tokens, words };
}

// src/engine/voice/ssm-acoustic-model.ts
var DEFAULTS = {
  sampleRate: 24e3,
  numMels: 80,
  hopLength: 256,
  frameLength: 1024,
  numQuantizers: 4,
  codebookSize: 256,
  charsPerSecond: 14,
  hiddenDim: 256
};
var SSMAcousticModel = class {
  cfg;
  /** Hashed character-embedding table [vocab][hiddenDim]. */
  charEmbed;
  /** Speaker-embedding → hidden projection (sign matrix), built lazily per
   *  speaker-dim so a mismatched embedding can't silently mis-multiply. */
  speakerProj = null;
  /** Per-quantizer output projection: hidden → codebookSize logits. */
  outProj;
  /** SSM per-channel decay (diagonal A), stable in [0.5, 0.99). */
  decay;
  constructor(options = {}) {
    this.cfg = {
      sampleRate: options.sampleRate ?? DEFAULTS.sampleRate,
      numMels: options.numMels ?? DEFAULTS.numMels,
      hopLength: options.hopLength ?? DEFAULTS.hopLength,
      frameLength: options.frameLength ?? DEFAULTS.frameLength,
      numQuantizers: options.numQuantizers ?? DEFAULTS.numQuantizers,
      codebookSize: options.codebookSize ?? DEFAULTS.codebookSize,
      charsPerSecond: options.charsPerSecond ?? DEFAULTS.charsPerSecond,
      hiddenDim: options.hiddenDim ?? DEFAULTS.hiddenDim
    };
    const h = this.cfg.hiddenDim;
    const embedRand = mulberry32(2021);
    this.charEmbed = [];
    for (let t = 0; t < TEXT_VOCAB_SIZE; t++) {
      const vec = new Float32Array(h);
      for (let i = 0; i < h; i++) {
        vec[i] = Math.sin((t + 1) * (i + 1) * 0.07 + embedRand() * 6.283);
      }
      this.charEmbed.push(vec);
    }
    this.outProj = [];
    for (let q = 0; q < this.cfg.numQuantizers; q++) {
      const signs = new Int8Array(h * this.cfg.codebookSize);
      const rand = mulberry32(23 + Math.imul(q, 40503) >>> 0);
      for (let i = 0; i < signs.length; i++) signs[i] = rand() < 0.5 ? -1 : 1;
      this.outProj.push(signs);
    }
    this.decay = new Float32Array(h);
    const decayRand = mulberry32(912551);
    for (let i = 0; i < h; i++) this.decay[i] = 0.5 + decayRand() * 0.49;
  }
  /**
   * Generate codec tokens for `text` in the voice described by `speaker`.
   * `speed` (>0, default 1) scales the predicted duration: 1.5 ≈ 50 % faster.
   */
  generate(text, speaker, speed = 1) {
    const h = this.cfg.hiddenDim;
    const charCount = Math.max(1, text.tokens.length);
    const seconds = charCount / (this.cfg.charsPerSecond * (speed > 0 ? speed : 1));
    const numFrames = Math.max(1, Math.round(seconds * this.cfg.sampleRate / this.cfg.hopLength));
    const speakerVec = this.projectSpeaker(speaker, h);
    const state = new Float32Array(h);
    const tokens = [];
    for (let f = 0; f < numFrames; f++) {
      const charIdx = Math.min(
        text.tokens.length - 1,
        Math.floor(f / numFrames * text.tokens.length)
      );
      const charVec = this.charEmbed[text.tokens[charIdx] ?? 0];
      for (let i = 0; i < h; i++) {
        const input = charVec[i] + speakerVec[i];
        state[i] = this.decay[i] * state[i] + (1 - this.decay[i]) * input;
      }
      tokens.push(this.project(state, speakerVec));
    }
    return {
      codec: {
        tokens,
        numFrames,
        numQuantizers: this.cfg.numQuantizers,
        codebookSize: this.cfg.codebookSize,
        hopLength: this.cfg.hopLength,
        frameLength: this.cfg.frameLength,
        sampleRate: this.cfg.sampleRate
      },
      wordTimestamps: alignWords(text, numFrames, this.cfg.hopLength, this.cfg.sampleRate)
    };
  }
  /** hidden state → one token id per quantizer (argmax of speaker-biased logits). */
  project(state, speakerVec) {
    const h = this.cfg.hiddenDim;
    const v = this.cfg.codebookSize;
    const ids = [];
    for (let q = 0; q < this.cfg.numQuantizers; q++) {
      const signs = this.outProj[q];
      let bestId = 0;
      let bestLogit = -Infinity;
      for (let c = 0; c < v; c++) {
        let logit = 0;
        const base = c * h;
        for (let i = 0; i < h; i++) logit += signs[base + i] * state[i];
        logit += speakerVec[c % h] * 0.5;
        if (logit > bestLogit) {
          bestLogit = logit;
          bestId = c;
        }
      }
      ids.push(bestId);
    }
    return ids;
  }
  /** Project a speaker embedding to the hidden dim with a cached sign matrix. */
  projectSpeaker(speaker, h) {
    const dim = speaker.dim;
    if (!this.speakerProj || this.speakerProj.dim !== dim) {
      const signs2 = new Int8Array(dim * h);
      const rand = mulberry32((21481 ^ Math.imul(dim, 40503)) >>> 0);
      for (let i = 0; i < signs2.length; i++) signs2[i] = rand() < 0.5 ? -1 : 1;
      this.speakerProj = { dim, signs: signs2 };
    }
    const { signs } = this.speakerProj;
    const out = new Float32Array(h);
    const scale = 1 / Math.sqrt(dim);
    for (let o = 0; o < h; o++) {
      let sum = 0;
      for (let i = 0; i < dim; i++) sum += signs[i * h + o] * speaker.data[i];
      out[o] = sum * scale;
    }
    return out;
  }
};
function alignWords(text, numFrames, hopLength, sampleRate) {
  if (text.words.length === 0) return [];
  const totalChars = Math.max(1, text.tokens.length);
  const msPerFrame = hopLength / sampleRate * 1e3;
  const result = [];
  for (const w of text.words) {
    const startFrame = Math.round(w.startChar / totalChars * numFrames);
    const endFrame = Math.round(w.endChar / totalChars * numFrames);
    result.push({
      word: w.word,
      startMs: Math.round(startFrame * msPerFrame),
      endMs: Math.round(endFrame * msPerFrame)
    });
  }
  return result;
}

// src/engine/voice/voice-clone-engine.ts
var VoiceCloneEngine = class {
  codec;
  acoustic;
  speakerOptions;
  sampleRate;
  constructor(options = {}) {
    this.codec = new NeuralCodec(options.codec);
    this.sampleRate = this.codec.sampleRate;
    this.acoustic = new SSMAcousticModel({
      sampleRate: this.sampleRate,
      numQuantizers: this.codec.quantizers,
      codebookSize: this.codec.vocabSize,
      ...options.acoustic
    });
    this.speakerOptions = { sampleRate: this.sampleRate, ...options.speaker };
  }
  /** Enrol a voice: reference sample ▶ reusable speaker embedding. Run once and
   *  persist the embedding (it's just numbers) — synthesis takes the embedding,
   *  not the raw audio, so the reference never has to be re-fetched per clip. */
  enroll(reference) {
    return encodeSpeaker(reference, this.speakerOptions);
  }
  /** Speak `text` in `speaker`'s voice. */
  async synthesize(options) {
    const activeDevice = await this.resolveDevice(options.device);
    options.signal?.throwIfAborted();
    const text = tokenizeText(options.text);
    const { codec, wordTimestamps } = this.acoustic.generate(
      text,
      options.speaker,
      options.speed ?? 1
    );
    options.signal?.throwIfAborted();
    const { samples } = this.codec.decode(codec);
    peakNormalize(samples, 0.95);
    const durationMs = Math.round(samples.length / this.sampleRate * 1e3);
    return {
      pcm: samples,
      sampleRate: this.sampleRate,
      durationMs,
      wordTimestamps,
      codecTokens: codec,
      activeDevice
    };
  }
  /** Honour an explicit device, else probe (WebGPU preferred for the SSM scan,
   *  CPU always works). Never throws on probe failure — degrades to CPU. */
  async resolveDevice(requested) {
    if (requested) return requested;
    const probed = await probeDevice("auto");
    return probed?.kind ?? "cpu";
  }
};
function peakNormalize(samples, target) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak <= 0) return;
  const gain = target / peak;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
}

// src/engine/voice/provider.ts
var SSMVoiceProvider = class {
  id = "ssm-webgpu";
  engine;
  constructor(options) {
    this.engine = new VoiceCloneEngine(options);
  }
  /** Expose the engine for enrolment (`provider.engine.enroll(...)`). */
  get cloneEngine() {
    return this.engine;
  }
  async isAvailable() {
    return true;
  }
  async unavailableReason() {
    return null;
  }
  synthesize(options) {
    return this.engine.synthesize(options);
  }
};
async function resolveVoiceProvider(providers) {
  if (providers.length === 0) {
    return { provider: null, reason: "No clone provider is configured." };
  }
  const ordered = [...providers].sort((a, b) => preferenceRank(a) - preferenceRank(b));
  const reasons = [];
  for (const provider of ordered) {
    if (await provider.isAvailable()) {
      return { provider, reason: null };
    }
    const reason = await provider.unavailableReason();
    reasons.push(`${provider.id}: ${reason ?? "unavailable"}`);
  }
  return {
    provider: null,
    reason: `Cloning unavailable \u2014 ${reasons.join("; ")}`
  };
}
function preferenceRank(provider) {
  if (provider.id === "ssm-webgpu") return hasWebGPUSupport() ? 0 : 2;
  if (provider.id === "tts-server") return 1;
  return 3;
}

// src/engine/voice/wav.ts
function encodeWav(audio) {
  const { samples, sampleRate } = audio;
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
    offset += 2;
  }
  return buffer;
}
function encodeWavBlob(audio) {
  return new Blob([encodeWav(audio)], { type: "audio/wav" });
}
function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CAMERA_MOVES,
  MODEL_REGISTRY,
  NeuralCodec,
  SSMAcousticModel,
  SSMVoiceProvider,
  TEXT_VOCAB_SIZE,
  VideoEngine,
  VoiceCloneEngine,
  buildInterpolatedSequence,
  cameraMoveToMotion,
  composeShotPrompt,
  configureOnnxRuntime,
  cosineSimilarity,
  directorPass,
  encodeSpeaker,
  encodeWav,
  encodeWavBlob,
  estimateBlockMotion,
  hasWebGPUSupport,
  interpolateFrames,
  luma,
  melSpectrogram,
  melToWaveform,
  normaliseShotBudget,
  planKeyframeIndices,
  planScene,
  probeDevice,
  resolveVoiceProvider,
  shotPlannerPass,
  slerp,
  storyboardFrameCount,
  tokenizeText,
  validateFrame,
  verifySpeaker
});
//# sourceMappingURL=index.cjs.map