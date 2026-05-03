import type { MutableTensor, WebDiTManifest } from "./types";

/**
 * Classifier-free guidance: out = uncond + guidance * (cond - uncond).
 * guidance=0 → uncond, guidance=1 → cond, guidance>1 extrapolates past cond.
 */
export function applyClassifierFreeGuidance(
  uncond: MutableTensor,
  cond: MutableTensor,
  guidance: number,
): MutableTensor {
  assertSameLength(uncond, cond, "applyClassifierFreeGuidance");
  const out = new Float32Array(cond.data.length);
  for (let i = 0; i < out.length; i++) {
    const u = uncond.data[i]!;
    out[i] = u + guidance * (cond.data[i]! - u);
  }
  return { data: out, dims: cond.dims };
}

/**
 * VAE pixel tensor [B=1, C=3, T, H, W] in [-1, 1] -> per-frame RGBA Uint8ClampedArray.
 * Output is canvas-ready: pass each frame to `new ImageData(arr, w, h)`.
 */
export function splitFrames(
  pixels: Float32Array,
  frames: number,
  width: number,
  height: number,
): Uint8ClampedArray[] {
  const planeSize = height * width;
  const expected = 3 * frames * planeSize;
  if (pixels.length !== expected) {
    throw new Error(
      `splitFrames: expected ${expected} elements (3×${frames}×${height}×${width}), got ${pixels.length}`,
    );
  }
  const channelStride = frames * planeSize;
  const out: Uint8ClampedArray[] = [];
  for (let f = 0; f < frames; f++) {
    const frame = new Uint8ClampedArray(planeSize * 4);
    const tOffset = f * planeSize;
    for (let p = 0; p < planeSize; p++) {
      frame[p * 4 + 0] = unitToByte(pixels[0 * channelStride + tOffset + p]!);
      frame[p * 4 + 1] = unitToByte(pixels[1 * channelStride + tOffset + p]!);
      frame[p * 4 + 2] = unitToByte(pixels[2 * channelStride + tOffset + p]!);
      frame[p * 4 + 3] = 255;
    }
    out.push(frame);
  }
  return out;
}

/**
 * Initial latent noise sampled from N(0, 1). Shape derived from VAE
 * compression ratios so the runtime stays generic across architectures.
 */
export function makeNoiseLatent(
  manifest: WebDiTManifest,
  frames: number,
  height: number,
  width: number,
  seed?: number,
): MutableTensor {
  const latentT = Math.max(1, Math.ceil(frames / manifest.vaeCompression.temporal));
  const latentH = Math.max(1, Math.ceil(height / manifest.vaeCompression.spatial));
  const latentW = Math.max(1, Math.ceil(width / manifest.vaeCompression.spatial));
  const c = manifest.latentShape.c;
  const dims = [1, c, latentT, latentH, latentW] as const;
  const total = c * latentT * latentH * latentW;
  const data = new Float32Array(total);
  const sample = seededGaussian(seed);
  for (let i = 0; i < total; i++) data[i] = sample();
  return { data, dims };
}

export function assertSameLength(
  a: MutableTensor,
  b: MutableTensor,
  op: string,
): void {
  if (a.data.length !== b.data.length) {
    throw new Error(
      `${op}: tensor length mismatch (${a.data.length} vs ${b.data.length})`,
    );
  }
}

function unitToByte(v: number): number {
  return Math.round((v + 1) * 127.5);
}

function seededGaussian(seed?: number): () => number {
  const uniform = seed === undefined ? Math.random : mulberry32(seed);
  return () => {
    let u = uniform();
    while (u <= 0) u = uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform());
  };
}

function mulberry32(seed: number): () => number {
  let state = (seed >>> 0) || 0x12345678;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
