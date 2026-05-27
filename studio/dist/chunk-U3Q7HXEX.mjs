// src/engine/device-router.ts
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
  if (typeof navigator === "undefined") return null;
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
import * as ort from "onnxruntime-web";

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
var MODEL_REGISTRY = {
  "lcm-dreamshaper-v7": {
    id: "lcm-dreamshaper-v7",
    defaultSteps: 4,
    defaultGuidance: 1.5,
    minVramMb: 6 * 1024,
    hfRepo: "lcm-sd/lcm-dreamshaper-v7-onnx",
    files: {
      unet: "unet/model.onnx",
      vaeDecoder: "vae_decoder/model.onnx",
      textEncoder: "text_encoder/model.onnx",
      tokenizer: "tokenizer/tokenizer.json"
    }
  },
  "sd-turbo": {
    id: "sd-turbo",
    defaultSteps: 1,
    defaultGuidance: 0,
    minVramMb: 4 * 1024,
    hfRepo: "stabilityai/sd-turbo-onnx",
    files: {
      unet: "unet/model.onnx",
      vaeDecoder: "vae_decoder/model.onnx",
      textEncoder: "text_encoder/model.onnx",
      tokenizer: "tokenizer/tokenizer.json"
    }
  }
};
var DiffusionEngine = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  unetSession = null;
  vaeSession = null;
  textEncoderSession = null;
  tokenizerJson = null;
  async init() {
    const descriptor = MODEL_REGISTRY[this.opts.model];
    const sessionOptions = this.buildSessionOptions();
    const [unetBuf, vaeBuf, textEncBuf, tokenizerBuf] = await Promise.all([
      this.fetchWeight(descriptor.files.unet, descriptor.hfRepo),
      this.fetchWeight(descriptor.files.vaeDecoder, descriptor.hfRepo),
      this.fetchWeight(descriptor.files.textEncoder, descriptor.hfRepo),
      this.fetchWeight(descriptor.files.tokenizer, descriptor.hfRepo)
    ]);
    this.unetSession = await ort.InferenceSession.create(new Uint8Array(unetBuf), sessionOptions);
    this.vaeSession = await ort.InferenceSession.create(new Uint8Array(vaeBuf), sessionOptions);
    this.textEncoderSession = await ort.InferenceSession.create(
      new Uint8Array(textEncBuf),
      sessionOptions
    );
    this.tokenizerJson = JSON.parse(new TextDecoder().decode(tokenizerBuf));
  }
  /**
   * Run the full denoise → decode pipeline for one frame. The caller owns the
   * scheduler choice (LCM vs DDIM/Euler for SD-Turbo) by passing the right
   * `steps` and `guidance`. The shared primitive is responsible only for the
   * inner loop and VAE decode.
   */
  async denoise(inputs) {
    if (!this.unetSession || !this.vaeSession) {
      throw new Error("DiffusionEngine.init() not called");
    }
    let latent = new Float32Array(inputs.latent);
    const latentH = this.opts.height / 8;
    const latentW = this.opts.width / 8;
    for (let stepIdx = 0; stepIdx < inputs.steps; stepIdx++) {
      const sigma = sigmaForStep(stepIdx, inputs.steps);
      const timestep = stepToTimestep(stepIdx, inputs.steps);
      const noisePred = await this.runUnet({
        latent,
        condEmbedding: inputs.condEmbedding,
        uncondEmbedding: inputs.uncondEmbedding,
        timestep,
        guidance: inputs.guidance,
        latentShape: [1, 4, latentH, latentW]
      });
      for (let i = 0; i < latent.length; i++) {
        latent[i] = latent[i] - sigma * noisePred[i];
      }
    }
    const pixels = await this.runVaeDecode(latent, latentH, latentW);
    return { pixels };
  }
  /** Tokenise and embed the prompt. Returns [1, seqLen, embedDim] tensor. */
  async embedPrompt(_prompt) {
    if (!this.textEncoderSession || !this.tokenizerJson) {
      throw new Error("DiffusionEngine.init() not called");
    }
    const seqLen = 77;
    const embedDim = 768;
    return new Float32Array(seqLen * embedDim);
  }
  /** Allocate a fresh latent tensor seeded from a deterministic RNG. */
  sampleInitialLatent(seed) {
    const latentH = this.opts.height / 8;
    const latentW = this.opts.width / 8;
    const size = 1 * 4 * latentH * latentW;
    const out = new Float32Array(size);
    let state = seed >>> 0 || 1;
    for (let i = 0; i < size; i++) {
      state = state * 1664525 + 1013904223 >>> 0;
      const u1 = (state + 1) / 4294967296;
      state = state * 1664525 + 1013904223 >>> 0;
      const u2 = (state + 1) / 4294967296;
      out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
    return out;
  }
  get activeDevice() {
    return this.opts.probed.kind;
  }
  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------
  buildSessionOptions() {
    const kind = this.opts.probed.kind;
    if (kind === "webnn") {
      return { executionProviders: ["webnn", "wasm"] };
    }
    if (kind === "webgpu") {
      return { executionProviders: ["webgpu", "wasm"] };
    }
    return { executionProviders: ["wasm"] };
  }
  async fetchWeight(file, hfRepo) {
    return getOrFetchWeight({
      cacheKey: `${this.opts.model}/${file}`,
      hfRepo,
      hfPath: file,
      sources: this.opts.weightSources,
      apiKey: this.opts.apiKey,
      r2Base: this.opts.r2Base,
      onProgress: (loaded, total) => this.opts.onWeightProgress?.(file, loaded, total)
    });
  }
  async runUnet(args) {
    const session = this.unetSession;
    const sample = new ort.Tensor("float32", args.latent, args.latentShape);
    const ts = new ort.Tensor("int64", BigInt64Array.from([BigInt(args.timestep)]), [1]);
    const encHidden = new ort.Tensor("float32", args.condEmbedding, [1, 77, 768]);
    const feeds = {
      sample,
      timestep: ts,
      encoder_hidden_states: encHidden
    };
    const condOut = await session.run(feeds);
    const condNoise = condOut.out_sample?.data;
    if (!condNoise) throw new Error("UNet output missing `out_sample`");
    if (!args.uncondEmbedding || args.guidance <= 0) {
      return condNoise;
    }
    const uncondEncHidden = new ort.Tensor("float32", args.uncondEmbedding, [1, 77, 768]);
    const uncondOut = await session.run({ ...feeds, encoder_hidden_states: uncondEncHidden });
    const uncondNoise = uncondOut.out_sample?.data;
    const guided = new Float32Array(condNoise.length);
    for (let i = 0; i < condNoise.length; i++) {
      guided[i] = uncondNoise[i] + args.guidance * (condNoise[i] - uncondNoise[i]);
    }
    return guided;
  }
  async runVaeDecode(latent, h, w) {
    const session = this.vaeSession;
    const scaled = new Float32Array(latent.length);
    const scale = 0.18215;
    for (let i = 0; i < latent.length; i++) scaled[i] = latent[i] / scale;
    const input = new ort.Tensor("float32", scaled, [1, 4, h, w]);
    const out = await session.run({ latent_sample: input });
    const pixels = out.sample?.data;
    if (!pixels) throw new Error("VAE decoder output missing `sample`");
    return pixels;
  }
};
function sigmaForStep(stepIdx, totalSteps) {
  const t = (totalSteps - stepIdx) / totalSteps;
  return 0.1 + 0.9 * t;
}
function stepToTimestep(stepIdx, totalSteps) {
  return Math.round(999 * (1 - stepIdx / Math.max(1, totalSteps)));
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
import { BuilderforceClient } from "@seanhogg/builderforce-sdk";
var SYSTEM_PROMPT = 'You are a visual prompt engineer for a text-to-video diffusion model. Rewrite the user prompt into a single detailed paragraph optimized for a Stable Diffusion-class image model. Include: subject, action, environment, lighting, colour palette, camera angle, and a visual style descriptor (e.g. cinematic, anime, photoreal). Do not use newlines. Do not preface with "Here is" or any meta-commentary \u2014 output only the rewritten prompt. Keep it under 220 characters.';
async function expandPrompt(opts) {
  const client = new BuilderforceClient({
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
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
async function muxFramesToMp4(frames, opts) {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("WebCodecs VideoEncoder is not available in this browser");
  }
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
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
    const frames = [];
    const muxFrames = [];
    for (let frameIdx = 0; frameIdx < args.frames; frameIdx++) {
      if (args.signal?.aborted) {
        throw new DOMException("Generation aborted", "AbortError");
      }
      const conditionedPrompt = coherenceMode === "prompt-bias" ? applyToPrompt({
        ctx: { mode: coherenceMode, strength: coherenceStrength, state: this.mambaState },
        promptEmbedding,
        seqLen: 77,
        embedDim: 768
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
        steps,
        guidance
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

export {
  probeDevice,
  MODEL_REGISTRY,
  VideoEngine
};
//# sourceMappingURL=chunk-U3Q7HXEX.mjs.map