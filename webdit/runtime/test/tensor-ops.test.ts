import { describe, it, expect } from "vitest";
import {
  applyClassifierFreeGuidance,
  makeNoiseLatent,
  splitFrames,
} from "../src/tensor-ops";
import type { MutableTensor, WebDiTManifest } from "../src/types";

const t = (data: number[], dims: number[]): MutableTensor => ({
  data: new Float32Array(data),
  dims,
});

describe("applyClassifierFreeGuidance", () => {
  it("returns uncond when guidance is 0", () => {
    const out = applyClassifierFreeGuidance(t([1, 2, 3], [3]), t([10, 20, 30], [3]), 0);
    expect(Array.from(out.data)).toEqual([1, 2, 3]);
  });

  it("returns cond when guidance is 1", () => {
    const out = applyClassifierFreeGuidance(t([1, 2, 3], [3]), t([10, 20, 30], [3]), 1);
    expect(Array.from(out.data)).toEqual([10, 20, 30]);
  });

  it("extrapolates past cond when guidance > 1 (formula u + g*(c-u))", () => {
    const out = applyClassifierFreeGuidance(t([0], [1]), t([1], [1]), 7.5);
    expect(out.data[0]).toBeCloseTo(7.5);
  });

  it("preserves output dims from cond", () => {
    const out = applyClassifierFreeGuidance(t([1, 2], [2]), t([3, 4], [1, 2]), 0.5);
    expect(out.dims).toEqual([1, 2]);
  });

  it("throws on length mismatch instead of silently truncating", () => {
    expect(() =>
      applyClassifierFreeGuidance(t([1], [1]), t([1, 2], [2]), 1),
    ).toThrow(/length mismatch/);
  });
});

describe("splitFrames", () => {
  it("emits one Uint8ClampedArray per frame, each width*height*4 bytes (RGBA)", () => {
    const pixels = new Float32Array(3 * 2 * 4 * 4); // 2 frames, 4×4
    const frames = splitFrames(pixels, 2, 4, 4);
    expect(frames.length).toBe(2);
    for (const f of frames) expect(f.length).toBe(4 * 4 * 4);
  });

  it("maps -1 -> 0 and 1 -> 255 with full-opacity alpha", () => {
    // Layout [C=3, T=1, H=1, W=1]: R, G, B
    const pixels = new Float32Array([-1, 0, 1]);
    const [frame] = splitFrames(pixels, 1, 1, 1);
    expect(frame![0]).toBe(0); // R
    expect(frame![1]).toBe(128); // G (round(0.5*255))
    expect(frame![2]).toBe(255); // B
    expect(frame![3]).toBe(255); // A
  });

  it("places channels correctly across multiple frames (CTHW layout)", () => {
    // 2 frames, 1×1, [C=3, T=2, H=1, W=1]:
    //   R = pixels[0..1], G = pixels[2..3], B = pixels[4..5]
    const pixels = new Float32Array([
      -1, 1, // R for frames 0, 1
      -1, 1, // G for frames 0, 1
      -1, 1, // B for frames 0, 1
    ]);
    const [f0, f1] = splitFrames(pixels, 2, 1, 1);
    expect(Array.from(f0!.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(f1!.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it("throws on size mismatch with the expected element count", () => {
    expect(() => splitFrames(new Float32Array(5), 1, 2, 2)).toThrow(/expected 12/);
  });
});

describe("makeNoiseLatent", () => {
  const baseManifest: WebDiTManifest = {
    bundleVersion: 1,
    architecture: "ltx2-distilled",
    quantization: "f16",
    scheduler: "flow-match-rect",
    backend: "ort",
    latentShape: { c: 4, t: 1, h: 1, w: 1 },
    vaeCompression: { spatial: 32, temporal: 8 },
    patchSize: { d: 1, h: 1, w: 1 },
    textEncoder: { kind: "clip-l", maxTokens: 77, embedDim: 768 },
    defaults: { steps: 8, guidanceScale: 1, frames: 16, height: 64, width: 64 },
    files: {
      ditGraph: "",
      ditWeightShards: [],
      textEncoderGraph: "",
      textEncoderWeights: "",
      vaeGraph: "",
      vaeWeights: "",
      tokenizer: "",
    },
  };

  it("derives latent shape from VAE compression ratios", () => {
    const out = makeNoiseLatent(baseManifest, 16, 64, 64);
    expect(out.dims).toEqual([1, 4, 2, 2, 2]); // T = 16/8, H = W = 64/32
    expect(out.data.length).toBe(1 * 4 * 2 * 2 * 2);
  });

  it("rounds shape up for non-divisible request sizes", () => {
    const out = makeNoiseLatent(baseManifest, 17, 65, 33);
    expect(out.dims).toEqual([1, 4, 3, 3, 2]);
  });

  it("is reproducible given the same seed", () => {
    const a = makeNoiseLatent(baseManifest, 8, 32, 32, 42);
    const b = makeNoiseLatent(baseManifest, 8, 32, 32, 42);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("differs across distinct seeds", () => {
    const a = makeNoiseLatent(baseManifest, 8, 32, 32, 1);
    const b = makeNoiseLatent(baseManifest, 8, 32, 32, 2);
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
  });

  it("approximates a standard normal distribution (mean ~0, std ~1)", () => {
    const m: WebDiTManifest = {
      ...baseManifest,
      latentShape: { c: 64, t: 1, h: 1, w: 1 },
    };
    const out = makeNoiseLatent(m, 64, 256, 256, 7);
    let sum = 0;
    let sumSq = 0;
    for (const v of out.data) {
      sum += v;
      sumSq += v * v;
    }
    const n = out.data.length;
    const mean = sum / n;
    const std = Math.sqrt(sumSq / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(std - 1)).toBeLessThan(0.05);
  });
});
