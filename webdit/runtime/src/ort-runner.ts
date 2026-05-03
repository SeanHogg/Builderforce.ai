import * as ort from "onnxruntime-web/webgpu";
import { BUNDLE_IO } from "@webdit/shared";
import type { LoadedBundle } from "./bundle";
import { makeScheduler } from "./scheduler";
import {
  applyClassifierFreeGuidance,
  makeNoiseLatent,
  splitFrames,
} from "./tensor-ops";
import type { MutableTensor, VideoGenerateRequest, VideoGenerateResult } from "./types";

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

async function encodeText(bundle: LoadedBundle, prompt: string): Promise<MutableTensor> {
  const enc = bundle.tokenizer.encode(prompt);
  const ids = new ort.Tensor("int64", enc.inputIds, [1, enc.inputIds.length]);
  const mask = new ort.Tensor("int64", enc.attentionMask, [1, enc.attentionMask.length]);
  const result = await bundle.textEncoder.run({
    [BUNDLE_IO.textEncoder.inputs.inputIds]: ids,
    [BUNDLE_IO.textEncoder.inputs.attentionMask]: mask,
  });
  return fromOrt(result[BUNDLE_IO.textEncoder.outputs.embeddings] as ort.Tensor);
}

async function runDit(
  bundle: LoadedBundle,
  latent: MutableTensor,
  t: number,
  textEmb: MutableTensor,
): Promise<MutableTensor> {
  const ts = new ort.Tensor("float32", new Float32Array([t]), [1]);
  const result = await bundle.dit.run({
    [BUNDLE_IO.dit.inputs.latent]: toOrt(latent),
    [BUNDLE_IO.dit.inputs.timestep]: ts,
    [BUNDLE_IO.dit.inputs.textEmb]: toOrt(textEmb),
  });
  return fromOrt(result[BUNDLE_IO.dit.outputs.velocity] as ort.Tensor);
}

async function runVae(bundle: LoadedBundle, latent: MutableTensor): Promise<Float32Array> {
  const result = await bundle.vae.run({
    [BUNDLE_IO.vae.inputs.latent]: toOrt(latent),
  });
  return (result[BUNDLE_IO.vae.outputs.pixels] as ort.Tensor).data as Float32Array;
}

function toOrt(t: MutableTensor): ort.Tensor {
  return new ort.Tensor("float32", t.data, [...t.dims]);
}

function fromOrt(t: ort.Tensor): MutableTensor {
  return { data: t.data as Float32Array, dims: t.dims };
}
