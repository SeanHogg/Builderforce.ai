/**
 * webdit-engine.ts — studio's second generation path: webdit's diffusion-
 * transformer (DiT) whole-clip video models (CogVideoX-2b, Wan2.5, Mochi-1,
 * LTX2-distilled), dispatched by `VideoEngine` alongside the original
 * lcm-diffusion frame-by-frame path (see `diffusion-engine.ts`).
 *
 * Mirrors `diffusion-engine.ts`'s role for this family: it's the ONLY module
 * that knows how to load a webdit bundle and run a webdit denoise pass.
 * `video-engine.ts` dispatches to this module's two exports and otherwise
 * stays ignorant of webdit's internals — same separation the lcm-diffusion
 * path already has between `video-engine.ts` and `diffusion-engine.ts`.
 *
 * Why a SEPARATE module rather than teaching DiffusionEngine a second mode:
 * webdit's `runDenoiseLoop` is a whole-clip generator over a native
 * multi-frame latent (temporal coherence is modeled BY the DiT itself), while
 * DiffusionEngine's primitives (embedPrompt/denoise/decodeLatent/
 * addNoiseToLatent) are fine-grained per-frame steps that `video-engine.ts`'s
 * `produceClip()` composes into Mamba coherence / anchor-walk / img2img /
 * two-pass refinement. Forcing a video-native DiT through that per-frame
 * machinery would be redundant (it already models coherence) and wrong
 * (its latent shape is [B,C,T,H,W], not per-frame [B,C,H,W]).
 *
 * `@webdit/runtime` is imported LAZILY (dynamic `import()`) everywhere in
 * this module so it — and its ORT/tensor-runner weight — are code-split:
 * a consumer that only ever selects lcm-diffusion models never pulls webdit
 * into their bundle (see the `external` entries in studio's tsup.config.ts).
 */

import type { WebDiTManifest } from '@webdit/shared';
import type { LoadedBundle } from '@webdit/runtime';
import type {
  GenerateOptions,
  GenerateResult,
  MambaStateSnapshot,
  WebDitModelDescriptor,
  WeightSource,
} from '../types';
import { configureOnnxRuntime } from './onnx-runtime-config';
import { getOrFetchWeight } from './weight-cache';
import { muxFramesToMp4, type MuxFrame } from './webcodecs-muxer';
import { reportProgress } from './diffusion-engine';

/** Default weight-source chain for webdit bundles — R2 only. Unlike the
 *  lcm-diffusion path (which falls back to the HuggingFace CDN because its
 *  weights ARE published HF repos), a webdit bundle is a bespoke artifact
 *  that only ever lives at `descriptor.bundleUrl` — there is no HF fallback
 *  repo for it, so `huggingface-cdn` is never a meaningful source here. */
const WEBDIT_WEIGHT_SOURCES: WeightSource[] = ['r2-proxy'];

export interface LoadWebDitBundleOptions {
  /** Builderforce API key — forwarded to `getOrFetchWeight`'s r2-proxy auth,
   *  same as every other studio weight fetch. */
  apiKey: string;
  /** Override the weight-source chain. Defaults to `['r2-proxy']` — see
   *  WEBDIT_WEIGHT_SOURCES. */
  weightSources?: WeightSource[];
  onProgress?: (label: string) => void;
}

/**
 * Load a webdit bundle for `descriptor` through studio's canonical weight
 * cache. Fetches `manifest.json` + every file `manifest.files` names (the DiT
 * graph, VAE graph, text-encoder graph, all DiT weight shards, and — for the
 * "ort" backend — the tokenizer.json/tokenizer_config.json pair) via
 * `getOrFetchWeight` (IndexedDB-backed, r2-proxy-sourced) instead of letting
 * webdit fetch raw URLs itself, then hands the resulting buffer map to
 * `@webdit/runtime`'s `loadBundleFromBuffers`.
 *
 * Throws if `descriptor.available` is false or `bundleUrl` is null — callers
 * (`VideoEngine.create`) MUST check both before calling this, matching the
 * "consumer never computes its own can-run check" contract by checking the
 * one thing (`available`/`bundleUrl`) that this function itself also asserts
 * defensively.
 */
export async function loadWebDitBundle(
  descriptor: WebDitModelDescriptor,
  opts: LoadWebDitBundleOptions,
): Promise<LoadedBundle> {
  if (!descriptor.available || !descriptor.bundleUrl) {
    throw new Error(
      `loadWebDitBundle: '${descriptor.id}' has no bundle uploaded yet (available: ${descriptor.available}, ` +
        `bundleUrl: ${descriptor.bundleUrl}). See the ROADMAP webdit gap-register entry.`,
    );
  }
  const bundleUrl = descriptor.bundleUrl;
  const weightSources = opts.weightSources ?? WEBDIT_WEIGHT_SOURCES;
  const onProgress = opts.onProgress;

  configureOnnxRuntime();

  const fetchBundleFile = (relPath: string): Promise<ArrayBuffer> =>
    getOrFetchWeight({
      cacheKey: `webdit/${descriptor.architecture}/${relPath}`,
      // getOrFetchWeight's FetchOptions always require an hfRepo/hfPath pair
      // (its huggingface-cdn fallback source), but webdit bundles have no HF
      // fallback repo — WEBDIT_WEIGHT_SOURCES omits 'huggingface-cdn' so this
      // pair is never actually dereferenced; it's supplied only to satisfy
      // the shared cache function's signature.
      hfRepo: descriptor.architecture,
      hfPath: relPath,
      sources: weightSources,
      apiKey: opts.apiKey,
      r2Base: bundleUrl,
      // Note: getOrFetchWeight's onProgress reports raw bytes-loaded/total for
      // ONE file's download, not the label-string phase progress this module
      // reports via reportProgress (one line per file, above/below each
      // fetchBundleFile call) — the two aren't the same shape, so this isn't
      // wired to `opts.onProgress` here.
    });

  reportProgress(`Loading WebDiT manifest for ${descriptor.id}…`, onProgress);
  const manifestBuf = await fetchBundleFile('manifest.json');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBuf)) as WebDiTManifest;

  const relPaths = collectBundleFilePaths(manifest);
  const files: Record<string, ArrayBuffer> = {};
  for (const rel of relPaths) {
    reportProgress(`Downloading webdit/${descriptor.architecture}/${rel}…`, onProgress);
    files[rel] = await fetchBundleFile(rel);
  }

  reportProgress(`Building WebDiT bundle (${manifest.backend} backend)…`, onProgress);
  const { loadBundleFromBuffers } = await import('@webdit/runtime');
  const bundle = await loadBundleFromBuffers(manifest, files);
  reportProgress(`WebDiT bundle ready — ${descriptor.id} (${manifest.architecture}).`, onProgress);
  return bundle;
}

/** Every bundle-relative path `loadWebDitBundle` must fetch for `manifest`.
 *  The tokenizer directory's two well-known files (see bundle.ts's header
 *  comment) are only needed for the "ort" backend — the "mini"/"torch" test
 *  backends use a built-in deterministic tokenizer and never read them. */
function collectBundleFilePaths(manifest: WebDiTManifest): string[] {
  const paths = [
    manifest.files.ditGraph,
    ...manifest.files.ditWeightShards,
    manifest.files.textEncoderGraph,
    manifest.files.textEncoderWeights,
    manifest.files.vaeGraph,
    manifest.files.vaeWeights,
  ];
  // ONNX external-data companions (see BundleFiles.ditGraphData's doc
  // comment in @webdit/shared) — present only for graphs whose embedded
  // weights exceed ONNX's ~2GB single-protobuf-file limit, e.g. cogvideox-2b's
  // multi-GB DiT/text-encoder graphs.
  for (const rel of [
    manifest.files.ditGraphData,
    manifest.files.textEncoderGraphData,
    manifest.files.vaeGraphData,
  ]) {
    if (rel) paths.push(rel);
  }
  if (manifest.backend === 'ort') {
    const dir = manifest.files.tokenizer.endsWith('/')
      ? manifest.files.tokenizer
      : `${manifest.files.tokenizer}/`;
    paths.push(`${dir}tokenizer.json`, `${dir}tokenizer_config.json`);
  }
  return paths;
}

export interface RunWebDitDenoiseArgs {
  prompt: string;
  negativePrompt?: string;
  /** Total frame count to generate. */
  frames?: number;
  steps?: number;
  guidance?: number;
  seed?: number;
  width?: number;
  height?: number;
  /**
   * Current Mamba state, forwarded UNCHANGED to `onFrame` — webdit's DiT
   * models are video-native and already model temporal coherence themselves,
   * so this path never reads or advances Mamba state (a deliberate no-op,
   * not a gap: see the file header + `VideoEngine.generateStoryboard`'s
   * webdit branch, which — for the same reason — carries no Mamba state
   * across shots either).
   */
  mambaState: MambaStateSnapshot;
  /** Global frame index base, so a storyboard's per-shot `onFrame` indices
   *  stay unique across shots — mirrors `ClipSpec.frameOffset` in
   *  video-engine.ts's lcm-diffusion `produceClip`. */
  frameOffset?: number;
  onProgress?: (label: string) => void;
  onFrame?: GenerateOptions['onFrame'];
  signal?: AbortSignal;
}

export interface WebDitDenoiseResult {
  frames: ImageBitmap[];
  muxFrames: MuxFrame[];
  width: number;
  height: number;
}

/**
 * Core webdit generation step, shared by `generateWebDitClip` (one clip) and
 * `VideoEngine.generateStoryboard`'s webdit branch (one shot at a time,
 * concatenated and muxed ONCE at the end — see that method). Runs webdit's
 * whole-clip `runDenoiseLoop` and converts its `Uint8ClampedArray[]` output
 * frames into `ImageBitmap`s (same idiom `video-engine.ts`'s `produceClip`
 * already uses) plus `MuxFrame[]`. Does NOT mux — callers that want a single
 * clip's MP4 use `generateWebDitClip`; a storyboard mixes multiple calls'
 * frames into one mux pass instead.
 */
export async function runWebDitDenoise(
  bundle: LoadedBundle,
  args: RunWebDitDenoiseArgs,
): Promise<WebDitDenoiseResult> {
  const { runDenoiseLoop } = await import('@webdit/runtime');
  const onProgress = args.onProgress;
  const frameOffset = args.frameOffset ?? 0;

  reportProgress('Running WebDiT denoise loop…', onProgress);
  const result = await runDenoiseLoop(bundle, {
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    frames: args.frames,
    height: args.height,
    width: args.width,
    steps: args.steps,
    guidanceScale: args.guidance,
    seed: args.seed,
    onProgress: (step, total) => reportProgress(`WebDiT denoise step ${step}/${total}…`, onProgress),
  });

  const frames: ImageBitmap[] = new Array(result.frames.length);
  const muxFrames: MuxFrame[] = new Array(result.frames.length);
  for (let i = 0; i < result.frames.length; i++) {
    if (args.signal?.aborted) throw new DOMException('Generation aborted', 'AbortError');
    const rgba = result.frames[i];
    const bitmap = await createImageBitmap(
      new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, result.width, result.height),
    );
    frames[i] = bitmap;
    muxFrames[i] = { rgba };
    args.onFrame?.(frameOffset + i, bitmap, args.mambaState);
  }

  return { frames, muxFrames, width: result.width, height: result.height };
}

export interface GenerateWebDitClipArgs extends RunWebDitDenoiseArgs {
  /** Playback framerate of the output MP4. */
  fps: number;
  signal?: AbortSignal;
}

/**
 * Generate one clip through a loaded webdit bundle and mux it to MP4 —
 * `runWebDitDenoise` + a single `muxFramesToMp4` call, reused unchanged so
 * webdit and lcm-diffusion clips are muxed through the exact same encoder
 * path. Used by `VideoEngine.generate()`'s webdit branch.
 */
export async function generateWebDitClip(
  bundle: LoadedBundle,
  args: GenerateWebDitClipArgs,
): Promise<GenerateResult> {
  const start = performance.now();
  const { frames, muxFrames, width, height } = await runWebDitDenoise(bundle, args);

  reportProgress(`Encoding ${frames.length} frames to MP4…`, args.onProgress);
  const blob = await muxFramesToMp4(muxFrames, {
    width,
    height,
    fps: args.fps,
    signal: args.signal,
  });
  reportProgress('MP4 ready.', args.onProgress);

  return {
    blob,
    // No-op passthrough — see RunWebDitDenoiseArgs.mambaState.
    mambaState: args.mambaState,
    frames,
    activeDevice: 'webgpu',
    resolvedPrompt: args.prompt,
    elapsedMs: performance.now() - start,
  };
}
