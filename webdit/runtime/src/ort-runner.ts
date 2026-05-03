import type { LoadedBundle } from "./bundle";
import { makeScheduler } from "./scheduler";
import {
  applyClassifierFreeGuidance,
  makeNoiseLatent,
  splitFrames,
} from "./tensor-ops";
import type { VideoGenerateRequest, VideoGenerateResult } from "./types";

/**
 * Backend-agnostic denoise loop. Takes a LoadedBundle whose runners may be
 * ORT-backed (production) or Mini-backed (integration tests) — the loop
 * doesn't care.
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
  const latentT = latent.dims[2]!;
  const latentH = latent.dims[3]!;
  const latentW = latent.dims[4]!;
  const outFrames = latentT * m.vaeCompression.temporal;
  const outHeight = latentH * m.vaeCompression.spatial;
  const outWidth = latentW * m.vaeCompression.spatial;
  return {
    frames: splitFrames(pixels, outFrames, outWidth, outHeight),
    width: outWidth,
    height: outHeight,
    elapsedMs: performance.now() - t0,
  };
}

async function encodeText(
  bundle: LoadedBundle,
  prompt: string,
): Promise<import("./types").MutableTensor> {
  const { inputIds, attentionMask } = bundle.tokenizer.encode(prompt);
  return bundle.textEncoder.run(inputIds, attentionMask);
}
