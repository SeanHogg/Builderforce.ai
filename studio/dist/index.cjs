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
  CoherenceControls: () => CoherenceControls,
  MODEL_REGISTRY: () => MODEL_REGISTRY,
  ModelPicker: () => ModelPicker,
  StudioPanel: () => StudioPanel,
  VideoEngine: () => VideoEngine,
  VideoPreview: () => VideoPreview,
  hasWebGPUSupport: () => hasWebGPUSupport,
  probeDevice: () => probeDevice,
  useEngineStatus: () => useEngineStatus
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
    return {
      kind: "webgpu",
      gpuDevice: device,
      label,
      approxMemoryMb: estimateGpuMemoryMb(adapter)
    };
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
function estimateGpuMemoryMb(adapter) {
  const max = adapter.limits.maxBufferSize;
  if (!max) return null;
  return Math.round(max / (1024 * 1024));
}

// src/engine/diffusion-engine.ts
var ort = __toESM(require("onnxruntime-web"), 1);
var import_transformers = require("@huggingface/transformers");

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

// src/engine/diffusion-engine.ts
import_transformers.env.allowLocalModels = false;
if (import_transformers.env.backends?.onnx?.wasm) {
  import_transformers.env.backends.onnx.wasm.numThreads = 1;
}
var MODEL_REGISTRY = {
  "lcm-dreamshaper-v7": {
    id: "lcm-dreamshaper-v7",
    defaultSteps: 4,
    defaultGuidance: 1,
    // LCM works best with CFG ~1
    minVramMb: 6 * 1024,
    hfRepo: "Xenova/LCM_Dreamshaper_v7-onnx",
    textEmbedDim: 768,
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999, 759, 519, 259],
    files: {
      unet: "unet/model_fp16.onnx",
      vaeDecoder: "vae_decoder/model_fp16.onnx"
    }
  },
  "sd-turbo": {
    id: "sd-turbo",
    defaultSteps: 1,
    defaultGuidance: 0,
    // SD-Turbo is unconditional CFG
    minVramMb: 4 * 1024,
    hfRepo: "Xenova/sd-turbo",
    textEmbedDim: 1024,
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999],
    files: {
      unet: "unet/model_fp16.onnx",
      vaeDecoder: "vae_decoder/model_fp16.onnx"
    }
  }
};
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
var DiffusionEngine = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  tokenizer = null;
  textEncoder = null;
  unetSession = null;
  vaeSession = null;
  // -------------------------------------------------------------------------
  async init() {
    const descriptor = this.descriptor;
    const sessionOptions = this.buildSessionOptions();
    const hfDevice = this.mapDeviceToHf();
    const hfDtype = hfDevice === "webgpu" ? "fp16" : "fp32";
    this.tokenizer = await import_transformers.AutoTokenizer.from_pretrained(descriptor.hfRepo);
    this.textEncoder = await import_transformers.AutoModel.from_pretrained(descriptor.hfRepo, {
      subfolder: "text_encoder",
      device: hfDevice,
      dtype: hfDtype
    });
    const [unetBuf, vaeBuf] = await Promise.all([
      this.fetchWeight(descriptor.files.unet),
      this.fetchWeight(descriptor.files.vaeDecoder)
    ]);
    this.unetSession = await ort.InferenceSession.create(new Uint8Array(unetBuf), sessionOptions);
    this.vaeSession = await ort.InferenceSession.create(new Uint8Array(vaeBuf), sessionOptions);
  }
  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------
  get descriptor() {
    return MODEL_REGISTRY[this.opts.model];
  }
  get activeDevice() {
    return this.opts.probed.kind;
  }
  /** Tokenise and encode the prompt → conditioning embedding [1, seqLen, embedDim]. */
  async embedPrompt(prompt) {
    if (!this.tokenizer || !this.textEncoder) {
      throw new Error("DiffusionEngine.init() not called");
    }
    const { textEmbedDim, sequenceLength } = this.descriptor;
    const encoded = await this.tokenizer(prompt, {
      padding: "max_length",
      max_length: sequenceLength,
      truncation: true,
      return_tensors: "pt"
    });
    const out = await this.textEncoder({ input_ids: encoded.input_ids });
    const hidden = out.last_hidden_state?.data;
    if (!hidden) {
      throw new Error("Text encoder returned no last_hidden_state");
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
    return { pixels };
  }
  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  buildSessionOptions() {
    const kind = this.opts.probed.kind;
    if (kind === "webnn") return { executionProviders: ["webnn", "wasm"] };
    if (kind === "webgpu") return { executionProviders: ["webgpu", "wasm"] };
    return { executionProviders: ["wasm"] };
  }
  mapDeviceToHf() {
    const kind = this.opts.probed.kind;
    if (kind === "webgpu") return "webgpu";
    if (kind === "webnn") return "webnn";
    return "wasm";
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
  async runUnet(args) {
    const session = this.unetSession;
    const { textEmbedDim, sequenceLength } = this.descriptor;
    const sampleTensor = new ort.Tensor("float32", args.sample, args.latentShape);
    const tsTensor = new ort.Tensor("int64", BigInt64Array.from([BigInt(args.timestep)]), [1]);
    const condTensor = new ort.Tensor(
      "float32",
      args.condEmbedding,
      [1, sequenceLength, textEmbedDim]
    );
    const condOut = await session.run({
      sample: sampleTensor,
      timestep: tsTensor,
      encoder_hidden_states: condTensor
    });
    const condNoise = pickFirstFloat32(condOut);
    if (!condNoise) throw new Error("UNet returned no Float32 output");
    if (!args.uncondEmbedding || args.guidance <= 0) {
      return condNoise;
    }
    const uncondTensor = new ort.Tensor(
      "float32",
      args.uncondEmbedding,
      [1, sequenceLength, textEmbedDim]
    );
    const uncondOut = await session.run({
      sample: sampleTensor,
      timestep: tsTensor,
      encoder_hidden_states: uncondTensor
    });
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
    const input = new ort.Tensor("float32", scaled, [1, 4, h, w]);
    const out = await session.run({ latent_sample: input });
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

// src/engine/llm-bridge.ts
var import_builderforce_sdk = require("@seanhogg/builderforce-sdk");
var SYSTEM_PROMPT = 'You are a visual prompt engineer for a text-to-video diffusion model. Rewrite the user prompt into a single detailed paragraph optimized for a Stable Diffusion-class image model. Include: subject, action, environment, lighting, colour palette, camera angle, and a visual style descriptor (e.g. cinematic, anime, photoreal). Do not use newlines. Do not preface with "Here is" or any meta-commentary \u2014 output only the rewritten prompt. Keep it under 220 characters.';
async function expandPrompt(opts) {
  const client = new import_builderforce_sdk.BuilderforceClient({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl
  });
  const completion = await client.chat.completions.create({
    model: "auto",
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
var VideoEngine = class _VideoEngine {
  constructor(opts, diffusion, mambaState, activeDevice) {
    this.opts = opts;
    this.diffusion = diffusion;
    this.mambaState = mambaState;
    this.activeDevice = activeDevice;
  }
  opts;
  diffusion;
  mambaState;
  activeDevice;
  /**
   * Construct an engine bound to the host's best available hardware. Returns
   * `null` when no device path is viable — the consumer should render an
   * unsupported state rather than try to recover.
   */
  static async create(options) {
    const probed = await probeDevice(options.device ?? "auto");
    if (!probed) return null;
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
      height
    });
    await diffusion.init();
    const state = options.mambaState ?? emptyState({ dim: 64, order: 4, channels: 16 });
    return new _VideoEngine(
      { ...options, weightSources, width, height },
      diffusion,
      state,
      probed.kind
    );
  }
  /**
   * Generate one video clip. Per-frame work is sequential (frames depend on
   * the previous frame's Mamba state). Returns the muxed MP4 plus the updated
   * state — caller can persist the state for follow-up generations.
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
    const resolvedPrompt = args.skipPromptExpansion ? args.prompt : await expandPrompt({
      apiKey: this.opts.apiKey,
      baseUrl: this.opts.baseUrl,
      prompt: args.prompt,
      signal: args.signal
    });
    args.onPromptExpanded?.(resolvedPrompt);
    const promptEmbedding = await this.diffusion.embedPrompt(resolvedPrompt);
    const negativeEmbedding = args.negativePrompt ? await this.diffusion.embedPrompt(args.negativePrompt) : null;
    const timesteps = trimTimesteps(descriptor.defaultTimesteps, steps);
    const frames = [];
    const muxFrames = [];
    for (let frameIdx = 0; frameIdx < args.frames; frameIdx++) {
      if (args.signal?.aborted) {
        throw new DOMException("Generation aborted", "AbortError");
      }
      const conditionedPrompt = coherenceMode === "prompt-bias" ? applyToPrompt({
        ctx: { mode: coherenceMode, strength: coherenceStrength, state: this.mambaState },
        promptEmbedding,
        seqLen: descriptor.sequenceLength,
        embedDim: descriptor.textEmbedDim
      }) : promptEmbedding;
      let latent = this.diffusion.sampleInitialLatent(seed + frameIdx);
      if (coherenceMode === "latent-residual") {
        latent = applyToLatent({
          ctx: { mode: coherenceMode, strength: coherenceStrength, state: this.mambaState },
          latent
        });
      }
      const { pixels } = await this.diffusion.denoise({
        latent,
        condEmbedding: conditionedPrompt,
        uncondEmbedding: negativeEmbedding,
        timesteps,
        guidance,
        seed: seed + frameIdx
      });
      const rgba = pixelsToRgba(pixels, width, height);
      const imageData = new ImageData(
        rgba,
        width,
        height
      );
      const bitmap = await createImageBitmap(imageData);
      this.mambaState = advanceState(this.mambaState, pixels);
      frames.push(bitmap);
      muxFrames.push({ rgba });
      args.onFrame?.(frameIdx, bitmap, this.mambaState);
    }
    const blob = await muxFramesToMp4(muxFrames, {
      width,
      height,
      fps: args.fps,
      signal: args.signal
    });
    return {
      blob,
      mambaState: this.mambaState,
      frames,
      activeDevice: this.activeDevice,
      resolvedPrompt,
      elapsedMs: performance.now() - start
    };
  }
  /** Read the current Mamba state without mutating the engine — for persistence. */
  getMambaState() {
    return this.mambaState;
  }
  /** Replace the Mamba state — used when resuming a session from R2 / IDB. */
  setMambaState(state) {
    this.mambaState = state;
  }
};
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

// src/components/StudioPanel.tsx
var import_react3 = require("react");

// src/components/ModelPicker.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var MODEL_LABELS = {
  "lcm-dreamshaper-v7": "LCM Dreamshaper v7 \u2014 4-step, balanced quality",
  "sd-turbo": "SD-Turbo \u2014 1-step, fastest"
};
function ModelPicker({ value, onChange, disabled }) {
  const entries = Object.keys(MODEL_REGISTRY);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bfs-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "bfs-label", children: "Diffusion model" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "select",
      {
        className: "bfs-select",
        value,
        onChange: (e) => onChange(e.target.value),
        disabled,
        children: entries.map((id) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: id, children: MODEL_LABELS[id] }, id))
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "bfs-hint", children: [
      MODEL_REGISTRY[value].defaultSteps,
      " step",
      MODEL_REGISTRY[value].defaultSteps > 1 ? "s" : "",
      " ",
      "\xB7 ~",
      Math.round(MODEL_REGISTRY[value].minVramMb / 1024),
      " GB VRAM minimum"
    ] })
  ] });
}

// src/components/CoherenceControls.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var MODE_DESCRIPTIONS = {
  "prompt-bias": "Mamba state biases the prompt embedding. Lightweight, works with any U-Net.",
  "latent-residual": "Mamba state biases the initial latent noise. Stronger temporal lock, slightly more compute."
};
function CoherenceControls({
  mode,
  strength,
  onModeChange,
  onStrengthChange,
  disabled
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "bfs-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "bfs-label", children: "Temporal coherence (Mamba state)" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "bfs-radio-row", children: ["prompt-bias", "latent-residual"].map((m) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "bfs-radio", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "input",
        {
          type: "radio",
          name: "bfs-coherence",
          value: m,
          checked: mode === m,
          onChange: () => onModeChange(m),
          disabled
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: m === "prompt-bias" ? "Prompt bias" : "Latent residual" })
    ] }, m)) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "bfs-hint", children: MODE_DESCRIPTIONS[mode] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "bfs-label", style: { marginTop: 12 }, children: [
      "Coherence strength: ",
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "bfs-mono", children: strength.toFixed(2) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "input",
      {
        type: "range",
        min: 0,
        max: 1,
        step: 0.05,
        value: strength,
        onChange: (e) => onStrengthChange(Number(e.target.value)),
        disabled,
        className: "bfs-range"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "bfs-hint", children: "0 = i.i.d. frames \xB7 1 = maximum lock to previous frame." })
  ] });
}

// src/components/VideoPreview.tsx
var import_react = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
function VideoPreview({ frames, videoUrl, width, height }) {
  const canvasRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    if (videoUrl) return;
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const latest = frames[frames.length - 1];
    ctx.drawImage(latest, 0, 0, canvas.width, canvas.height);
  }, [frames, videoUrl]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "bfs-preview", style: { aspectRatio: `${width} / ${height}` }, children: [
    videoUrl ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("video", { src: videoUrl, controls: true, autoPlay: true, loop: true, className: "bfs-preview-video" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("canvas", { ref: canvasRef, width, height, className: "bfs-preview-canvas" }),
    !videoUrl && frames.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "bfs-preview-empty", children: "Preview will appear here as frames generate." })
  ] });
}

// src/components/useEngineStatus.ts
var import_react2 = require("react");
function useEngineStatus() {
  const [status, setStatus] = (0, import_react2.useState)({ state: "probing" });
  (0, import_react2.useEffect)(() => {
    let cancelled = false;
    probeDevice("auto").then((device) => {
      if (cancelled) return;
      if (!device) {
        setStatus({
          state: "unsupported",
          reason: "This browser cannot run the AI Video Studio. Requires WebGPU (Chrome 113+, Edge 113+) or WebNN."
        });
        return;
      }
      setStatus({ state: "ready", device });
    }).catch((err) => {
      if (cancelled) return;
      setStatus({
        state: "unsupported",
        reason: err instanceof Error ? err.message : String(err)
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

// src/components/StudioPanel.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
var DEFAULT_WIDTH2 = 512;
var DEFAULT_HEIGHT2 = 512;
function StudioPanel({
  apiKey,
  baseUrl,
  defaultModel = "lcm-dreamshaper-v7",
  defaultCoherence = "prompt-bias",
  defaultFrames = 16,
  defaultFps = 8,
  onVideoGenerated,
  initialMambaState
}) {
  const status = useEngineStatus();
  const engineRef = (0, import_react3.useRef)(null);
  const abortRef = (0, import_react3.useRef)(null);
  const [prompt, setPrompt] = (0, import_react3.useState)("");
  const [model, setModel] = (0, import_react3.useState)(defaultModel);
  const [coherenceMode, setCoherenceMode] = (0, import_react3.useState)(defaultCoherence);
  const [coherenceStrength, setCoherenceStrength] = (0, import_react3.useState)(0.5);
  const [frames, setFrames] = (0, import_react3.useState)(defaultFrames);
  const [fps, setFps] = (0, import_react3.useState)(defaultFps);
  const [isGenerating, setIsGenerating] = (0, import_react3.useState)(false);
  const [progressLabel, setProgressLabel] = (0, import_react3.useState)("");
  const [expandedPrompt, setExpandedPrompt] = (0, import_react3.useState)("");
  const [previewFrames, setPreviewFrames] = (0, import_react3.useState)([]);
  const [videoUrl, setVideoUrl] = (0, import_react3.useState)(null);
  const [result, setResult] = (0, import_react3.useState)(null);
  const [error, setError] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);
  const handleGenerate = (0, import_react3.useCallback)(async () => {
    if (status.state !== "ready") return;
    if (!prompt.trim()) {
      setError("Enter a prompt before generating.");
      return;
    }
    if (!apiKey) {
      setError("Missing Builderforce API key.");
      return;
    }
    setError(null);
    setIsGenerating(true);
    setProgressLabel("Initialising engine\u2026");
    setPreviewFrames([]);
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    setResult(null);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      if (!engineRef.current) {
        const engine = await VideoEngine.create({
          apiKey,
          baseUrl,
          model,
          mambaState: initialMambaState,
          width: DEFAULT_WIDTH2,
          height: DEFAULT_HEIGHT2
        });
        if (!engine) {
          throw new Error("Engine refused to start on this device.");
        }
        engineRef.current = engine;
      }
      setProgressLabel("Expanding prompt via Builderforce LLM\u2026");
      const generated = await engineRef.current.generate({
        prompt,
        frames,
        fps,
        coherence: coherenceMode,
        coherenceStrength,
        signal: abort.signal,
        onPromptExpanded: (expanded) => {
          setExpandedPrompt(expanded);
          setProgressLabel("Generating frames\u2026");
        },
        onFrame: (idx, bitmap) => {
          setPreviewFrames((prev) => [...prev, bitmap]);
          setProgressLabel(`Frame ${idx + 1} / ${frames}`);
        }
      });
      const url = URL.createObjectURL(generated.blob);
      setVideoUrl(url);
      setResult(generated);
      onVideoGenerated?.(generated.blob, generated.mambaState);
      setProgressLabel(`Done in ${(generated.elapsedMs / 1e3).toFixed(1)}s on ${generated.activeDevice.toUpperCase()}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Generation aborted" || message === "Mux aborted") {
        setProgressLabel("Cancelled.");
      } else {
        setError(message);
        setProgressLabel("");
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [
    apiKey,
    baseUrl,
    coherenceMode,
    coherenceStrength,
    fps,
    frames,
    initialMambaState,
    model,
    onVideoGenerated,
    prompt,
    status.state,
    videoUrl
  ]);
  const handleCancel = (0, import_react3.useCallback)(() => {
    abortRef.current?.abort();
  }, []);
  const handleDownload = (0, import_react3.useCallback)(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = `builderforce-video-${Date.now()}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
  }, [result]);
  if (status.state === "probing") {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-root bfs-state-probing", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "bfs-spinner" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "Probing hardware (WebNN \u2192 WebGPU \u2192 CPU)\u2026" })
    ] });
  }
  if (status.state === "unsupported") {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-root bfs-state-unsupported", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { children: "AI Video Studio unavailable" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: status.reason }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "bfs-hint", children: "Open this page in Chrome 113+ or Edge 113+ with hardware acceleration enabled." })
    ] });
  }
  const device = status.device;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("header", { className: "bfs-header", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h1", { className: "bfs-title", children: "AI Video Studio" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "bfs-subtitle", children: [
        "Running on ",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: device.label }),
        device.approxMemoryMb ? ` \xB7 ~${(device.approxMemoryMb / 1024).toFixed(1)} GB available` : ""
      ] })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "bfs-controls", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { className: "bfs-label", htmlFor: "bfs-prompt", children: "What video do you want to generate?" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "textarea",
            {
              id: "bfs-prompt",
              className: "bfs-prompt",
              rows: 4,
              placeholder: "e.g. a fox running through autumn forest at golden hour, slow motion, cinematic",
              value: prompt,
              onChange: (e) => setPrompt(e.target.value),
              disabled: isGenerating
            }
          ),
          expandedPrompt && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "bfs-hint", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: "Expanded:" }),
            " ",
            expandedPrompt
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ModelPicker, { value: model, onChange: setModel, disabled: isGenerating }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-field bfs-flex", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { className: "bfs-label", children: "Frames" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              "input",
              {
                type: "number",
                className: "bfs-input",
                min: 1,
                max: 120,
                value: frames,
                onChange: (e) => setFrames(Math.max(1, Math.min(120, Number(e.target.value) || 1))),
                disabled: isGenerating
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-field bfs-flex", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { className: "bfs-label", children: "FPS" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              "input",
              {
                type: "number",
                className: "bfs-input",
                min: 1,
                max: 60,
                value: fps,
                onChange: (e) => setFps(Math.max(1, Math.min(60, Number(e.target.value) || 1))),
                disabled: isGenerating
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-field bfs-flex", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { className: "bfs-label", children: "Duration" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-readout", children: [
              (frames / fps).toFixed(2),
              "s"
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          CoherenceControls,
          {
            mode: coherenceMode,
            strength: coherenceStrength,
            onModeChange: setCoherenceMode,
            onStrengthChange: setCoherenceStrength,
            disabled: isGenerating
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "bfs-actions", children: [
          isGenerating ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "bfs-btn bfs-btn-danger", onClick: handleCancel, children: "Cancel" }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "button",
            {
              type: "button",
              className: "bfs-btn bfs-btn-primary",
              onClick: handleGenerate,
              disabled: !prompt.trim(),
              children: "Generate video"
            }
          ),
          result && !isGenerating && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "bfs-btn bfs-btn-secondary", onClick: handleDownload, children: "Download MP4" })
        ] }),
        progressLabel && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "bfs-progress", children: progressLabel }),
        error && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "bfs-error", children: error })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "bfs-preview-pane", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          VideoPreview,
          {
            frames: previewFrames,
            videoUrl,
            width: DEFAULT_WIDTH2,
            height: DEFAULT_HEIGHT2
          }
        ),
        result && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("dl", { className: "bfs-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "Device" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: result.activeDevice.toUpperCase() }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "Frames" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: result.frames.length }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "Mamba step" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: result.mambaState.step }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "Elapsed" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("dd", { children: [
            (result.elapsedMs / 1e3).toFixed(2),
            "s"
          ] })
        ] })
      ] })
    ] })
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CoherenceControls,
  MODEL_REGISTRY,
  ModelPicker,
  StudioPanel,
  VideoEngine,
  VideoPreview,
  hasWebGPUSupport,
  probeDevice,
  useEngineStatus
});
//# sourceMappingURL=index.cjs.map