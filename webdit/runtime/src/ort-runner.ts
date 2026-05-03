import * as ort from "onnxruntime-web/webgpu";
import type { LoadedBundle } from "./bundle";
import { makeScheduler } from "./scheduler";
import type { VideoGenerateRequest, VideoGenerateResult } from "./types";

/**
 * One pass of the diffusion loop. The high-level structure is shared across
 * every DiT architecture; per-arch specifics live in the converter (graph
 * shapes, scheduler kind, latent shape) and surface here through the manifest.
 */
export async function runDenoiseLoop(
  bundle: LoadedBundle,
  req: VideoGenerateRequest,
): Promise<VideoGenerateResult> {
  const t0 = performance.now();
  const m = bundle.manifest;
  const steps = req.steps ?? m.defaults.steps;
  const frames = req.frames ?? m.defaults.frames;
  const height = req.height ?? m.defaults.height;
  const width = req.width ?? m.defaults.width;
  const guidance = req.guidanceScale ?? m.defaults.guidanceScale;

  const cond = await encodeText(bundle, req.prompt);
  const uncond = await encodeText(bundle, req.negativePrompt ?? "");

  const latent = makeNoiseLatent(bundle, frames, height, width, req.seed);
  const scheduler = makeScheduler(m.scheduler, steps);

  for (let i = 0; i < steps; i++) {
    const t = scheduler.timestepAt(i);
    const eCond = await runDit(bundle, latent, t, cond);
    const eUncond = await runDit(bundle, latent, t, uncond);
    const guided = applyClassifierFreeGuidance(eUncond, eCond, guidance);
    scheduler.step(latent, guided, i);
    req.onProgress?.(i + 1, steps);
  }

  const pixels = await runVae(bundle, latent);
  return {
    frames: splitFrames(pixels, frames, width, height),
    width,
    height,
    elapsedMs: performance.now() - t0,
  };
}

// All helpers below are intentional stubs. They land in follow-up passes once
// the converter starts emitting real graphs and we know the actual I/O names.

async function encodeText(_b: LoadedBundle, _p: string): Promise<ort.Tensor> {
  throw new Error("encodeText not yet implemented");
}

function makeNoiseLatent(
  _b: LoadedBundle,
  _frames: number,
  _height: number,
  _width: number,
  _seed?: number,
): ort.Tensor {
  throw new Error("makeNoiseLatent not yet implemented");
}

async function runDit(
  _b: LoadedBundle,
  _latent: ort.Tensor,
  _t: number,
  _cond: ort.Tensor,
): Promise<ort.Tensor> {
  throw new Error("runDit not yet implemented");
}

function applyClassifierFreeGuidance(
  _uncond: ort.Tensor,
  _cond: ort.Tensor,
  _guidance: number,
): ort.Tensor {
  throw new Error("applyClassifierFreeGuidance not yet implemented");
}

async function runVae(_b: LoadedBundle, _latent: ort.Tensor): Promise<Float32Array> {
  throw new Error("runVae not yet implemented");
}

function splitFrames(
  _pixels: Float32Array,
  _frames: number,
  _width: number,
  _height: number,
): Uint8ClampedArray[] {
  throw new Error("splitFrames not yet implemented");
}
