/**
 * The diffusion model registry — single source of truth for per-model dims,
 * timesteps, VAE scale factors, ONNX file paths and the declared ORT input
 * contracts. Pure data: no ORT, no I/O, so the frame engine, the video
 * orchestrator, the device-fit hints and the contract tests all read it
 * without pulling in a runtime.
 */

import type { DiffusionModelId, ModelDescriptor } from '../types';

// ---------------------------------------------------------------------------
// Model registry — single source of truth for per-model dims, timesteps,
// VAE scale factors, and ONNX file paths. Every difference between
// LCM-Dreamshaper-v7 and SD-Turbo lives here, not in the denoise loop.
// ---------------------------------------------------------------------------

export const MODEL_REGISTRY: Record<DiffusionModelId, ModelDescriptor> = {
  'lcm-tiny-sd': {
    id: 'lcm-tiny-sd',
    engine: 'lcm-diffusion',
    defaultSteps: 4,
    defaultGuidance: 1.0,
    minVramMb: 2 * 1024, // BK-SDM Tiny UNet (~0.3 GB fp16) + text-encoder + VAE
    hfRepo: 'akameswa/lcm-tiny-sd-onnx-fp16',
    tokenizerRepo: 'Xenova/clip-vit-large-patch14',
    textEmbedDim: 768, // SD1.5 base
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999, 759, 519, 259],
    files: {
      textEncoder: { model: 'text_encoder/model.onnx' },
      unet: { model: 'unet/model.onnx', externalData: 'unet/model.onnx_data' },
      vaeDecoder: { model: 'vae_decoder/model.onnx', externalData: 'vae_decoder/model.onnx_data' },
    },
    // The akameswa export omits the LCM `timestep_cond` input (the "LCM" aspect
    // here is just the 4-step scheduler, not the consistency-embedding), but
    // it DOES keep the LCM-family float32 timestep — declaring int64 here
    // surfaces at first denoise as "Unexpected input data type. Actual:
    // (tensor(int64)), expected: (tensor(float))". The lcmFamilyTimestepIsFloat32
    // test in diffusion-engine.test.ts locks both LCM-family models on float32.
    unetInputs: [
      { name: 'sample', dtype: 'float32' },
      { name: 'timestep', dtype: 'float32' },
      { name: 'encoder_hidden_states', dtype: 'float32' },
    ],
    textEncoderInputs: [{ name: 'input_ids', dtype: 'int32' }],
    // lcmGuidanceEmbedDim intentionally omitted — see the unetInputs comment.
  },
  'lcm-dreamshaper-v7': {
    id: 'lcm-dreamshaper-v7',
    engine: 'lcm-diffusion',
    defaultSteps: 4,
    defaultGuidance: 1.0, // LCM works best with CFG ~1
    minVramMb: 6 * 1024,
    hfRepo: 'aislamov/lcm-dreamshaper-v7-onnx',
    tokenizerRepo: 'Xenova/clip-vit-large-patch14',
    textEmbedDim: 768, // SD1.5 base
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999, 759, 519, 259],
    files: {
      textEncoder: { model: 'text_encoder/model.onnx' },
      unet: { model: 'unet/model.onnx', externalData: 'unet/model.onnx_data' },
      vaeDecoder: { model: 'vae_decoder/model.onnx', externalData: 'vae_decoder/model.onnx_data' },
    },
    // LCM Dreamshaper (aislamov) UNet expects timestep as float32 (NOT int64).
    // Drift here surfaces as: "Unexpected input data type. Actual: int64, expected: float".
    unetInputs: [
      { name: 'sample', dtype: 'float32' },
      { name: 'timestep', dtype: 'float32' },
      { name: 'encoder_hidden_states', dtype: 'float32' },
      { name: 'timestep_cond', dtype: 'float32' },
    ],
    textEncoderInputs: [{ name: 'input_ids', dtype: 'int32' }],
    lcmGuidanceEmbedDim: 256, // standard for LCM-LoRA-derived exports
    lcmGuidanceScale: 8.5, // diffusers LCM default — embedded into timestep_cond (NOT defaultGuidance)
  },
  'sd-turbo': {
    id: 'sd-turbo',
    engine: 'lcm-diffusion',
    defaultSteps: 1,
    defaultGuidance: 0.0, // SD-Turbo is unconditional
    minVramMb: 4 * 1024,
    hfRepo: 'schmuell/sd-turbo-ort-web', // ORT-team browser demo build (single-file ONNX)
    tokenizerRepo: 'Xenova/clip-vit-large-patch14',
    textEmbedDim: 1024, // SD2.1 base
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999],
    files: {
      textEncoder: { model: 'text_encoder/model.onnx' },
      unet: { model: 'unet/model.onnx' },
      vaeDecoder: { model: 'vae_decoder/model.onnx' },
    },
    // schmuell/sd-turbo-ort-web export uses int64 timestep (standard SD UNet).
    unetInputs: [
      { name: 'sample', dtype: 'float32' },
      { name: 'timestep', dtype: 'int64' },
      { name: 'encoder_hidden_states', dtype: 'float32' },
    ],
    textEncoderInputs: [{ name: 'input_ids', dtype: 'int32' }],
  },

  // ---------------------------------------------------------------------
  // WebDiT diffusion-transformer entries — the whole-clip `webdit-engine.ts`
  // generation path (see WebDitModelDescriptor in types.ts). All 4 register
  // `available: false, bundleUrl: null`: the models are wired end-to-end
  // (this registry entry, VideoEngine dispatch, webdit-engine.ts) but no
  // pretrained bundle has been exported + uploaded to R2 yet — see the
  // ROADMAP gap-register entry. `defaultSteps`/`defaultGuidance`/
  // `defaultFrames`/`defaultWidth`/`defaultHeight` are copied from each
  // architecture's `SamplingDefaults` in webdit/converter/src/architectures/
  // (read from those files directly, not assumed). `minVramMb` are rough
  // estimates (no real bundle exists yet to measure) noted per entry.
  // ---------------------------------------------------------------------
  'cogvideox-2b': {
    id: 'cogvideox-2b',
    engine: 'webdit-dit',
    architecture: 'cogvideox-2b',
    // A real bundle IS uploaded (2026-08) — `studio-weights/webdit/cogvideox-2b/`
    // in the `builderforce-uploads` R2 bucket. This is the studio weights
    // proxy's own base URL, NOT `.../webdit/cogvideox-2b` — the
    // `webdit/<architecture>/` path segment is added by `webdit-engine.ts`'s
    // `fetchBundleFile` (its `cacheKey`, `webdit/${architecture}/${relPath}`,
    // is appended to this base by `getOrFetchWeight`'s r2-proxy resolver —
    // see `weight-cache.ts`'s `resolveSource`). Setting this to the
    // architecture-specific-looking URL the old comment on
    // `WebDitModelDescriptor.bundleUrl` suggested would double the path
    // segment and 404.
    bundleUrl: 'https://api.builderforce.ai/api/studio/weights',
    available: true,
    // Real ~1.7B-param DiT (THUDM/CogVideoX-2b) + real T5-XXL text encoder
    // (encoder-only, ~4.7B params) + VAE, all fp32 ONNX graphs — NOT the
    // CLIP-L swap the original placeholder comment assumed (see
    // webdit/converter/src/architectures/cogvideox.ts's header comment for
    // the full real-weights writeup). fp32 (not fp16) because CPU export
    // tracing needs it (PyTorch CPU doesn't run fp16 matmul); that plus the
    // real T5-XXL size makes the actual uploaded graph+external-data total
    // ~26.6 GB (dit 7.05 GB, text encoder 19.05 GB, vae 0.50 GB — MEASURED
    // from the real 2026-08 export, not estimated). This is almost
    // certainly too large for real-world WebGPU/browser use on typical
    // consumer VRAM (8-24 GB) — flagging honestly rather than
    // under-stating it: the bundle is genuinely wired end-to-end and
    // verified numerically correct, but practical in-browser usability
    // would need a follow-up fp16-graph pass (post-export precision
    // conversion) or real quantization-aware export, neither done here.
    minVramMb: 28 * 1024,
    defaultSteps: 50,
    defaultGuidance: 6.0,
    defaultFrames: 49,
    defaultFps: 8,
    defaultWidth: 720,
    defaultHeight: 480,
  },
  'wan2.5': {
    id: 'wan2.5',
    engine: 'webdit-dit',
    architecture: 'wan2.5',
    bundleUrl: null,
    available: false,
    // Full Wan2.5 is ~14B — only usable in-browser via a distilled/pruned
    // export (webdit/converter/src/architectures/wan.ts); estimate assumes
    // that distilled variant, not the full checkpoint.
    minVramMb: 10 * 1024,
    defaultSteps: 20,
    defaultGuidance: 5.0,
    defaultFrames: 81,
    defaultFps: 16,
    defaultWidth: 832,
    defaultHeight: 480,
  },
  'mochi-1': {
    id: 'mochi-1',
    engine: 'webdit-dit',
    architecture: 'mochi-1',
    bundleUrl: null,
    available: false,
    // 10B AsymmDiT (Genmo), distilled/quantized for browser use
    // (webdit/converter/src/architectures/mochi.ts) — the heaviest of the 4.
    minVramMb: 12 * 1024,
    defaultSteps: 64,
    defaultGuidance: 4.5,
    defaultFrames: 163,
    defaultFps: 24,
    defaultWidth: 848,
    defaultHeight: 480,
  },
  'ltx2-distilled': {
    id: 'ltx2-distilled',
    engine: 'webdit-dit',
    architecture: 'ltx2-distilled',
    bundleUrl: null,
    available: false,
    // ~2B DiT, rectified-flow, distilled to 8 steps — the fastest of the 4
    // (webdit/converter/src/architectures/ltx.ts).
    minVramMb: 6 * 1024,
    defaultSteps: 8,
    defaultGuidance: 1.0,
    defaultFrames: 121,
    defaultFps: 24,
    defaultWidth: 768,
    defaultHeight: 512,
  },
};
