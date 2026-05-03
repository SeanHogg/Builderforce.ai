import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { miniTest, quantize, writeBundle, type QuantizedTensor } from "@webdit/convert";
import { loadBundleFromDir } from "../src/bundle";
import { runDenoiseLoop } from "../src/ort-runner";

/**
 * Real-bytes end-to-end test. Builds a tiny synthetic bundle on disk using
 * the mini-test architecture, loads it via the runtime's bundle loader,
 * runs the denoise loop, and asserts frames come out the other end.
 *
 * No ONNX, no GPU, no real diffusion model — but every other piece of the
 * pipeline (manifest format, shard binary format, quantize/dequantize
 * round-trip, schedulers, CFG, splitFrames) is exercised on actual bytes.
 */

async function buildMiniBundle(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webdit-int-"));
  const out = path.join(root, "bundle");
  const stub = path.join(root, "stub");
  await fs.mkdir(stub, { recursive: true });
  // Mini backend doesn't read these, but bundle-writer copies them.
  await fs.writeFile(path.join(stub, "dit.onnx"), "MINI_DIT_PLACEHOLDER");
  await fs.writeFile(path.join(stub, "te.onnx"), "MINI_TE_PLACEHOLDER");
  await fs.writeFile(path.join(stub, "vae.onnx"), "MINI_VAE_PLACEHOLDER");
  await fs.mkdir(path.join(stub, "tokenizer"), { recursive: true });
  await fs.writeFile(path.join(stub, "tokenizer/tokenizer.json"), "{}");

  const ditWeights = new Map<string, QuantizedTensor>([
    ["dit.scale", quantize(new Float32Array([0.5, 0.4, 0.3, 0.2]), [4], "f16")],
    ["dit.bias", quantize(new Float32Array([0.0, 0.1, 0.0, -0.1]), [4], "f16")],
  ]);
  // 64-entry vocab × 8-dim embedding.
  const teData = new Float32Array(64 * 8);
  for (let i = 0; i < teData.length; i++) teData[i] = Math.sin(i * 0.1) * 0.2;
  const teWeights = new Map<string, QuantizedTensor>([
    ["te.proj", quantize(teData, [64, 8], "f16")],
  ]);
  // 3 RGB output × 4 latent input.
  const vaeWeights = new Map<string, QuantizedTensor>([
    [
      "vae.proj",
      quantize(
        new Float32Array([
          0.8, -0.1, 0.2, 0.05,
          0.1, 0.7, -0.2, 0.0,
          -0.05, 0.15, 0.6, 0.1,
        ]),
        [3, 4],
        "f16",
      ),
    ],
  ]);

  await writeBundle({
    output: out,
    manifest: miniTest.buildManifest("f16"),
    ditWeights,
    textEncoderWeights: teWeights,
    vaeWeights,
    graphs: {
      dit: path.join(stub, "dit.onnx"),
      textEncoder: path.join(stub, "te.onnx"),
      vae: path.join(stub, "vae.onnx"),
    },
    tokenizerDir: path.join(stub, "tokenizer"),
  });

  return {
    dir: out,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

describe("end-to-end: mini bundle → load → generate → frames", () => {
  let fix: Awaited<ReturnType<typeof buildMiniBundle>>;

  beforeEach(async () => {
    fix = await buildMiniBundle();
  });

  afterEach(() => fix.cleanup());

  it("produces frames of the right shape from a freshly-written bundle", async () => {
    const bundle = await loadBundleFromDir(fix.dir);
    expect(bundle.manifest.backend).toBe("mini");
    expect(bundle.manifest.architecture).toBe("mini-test");

    const result = await runDenoiseLoop(bundle, {
      prompt: "hello world",
      frames: 4,
      height: 8,
      width: 8,
      steps: 2,
      seed: 42,
    });

    // Latent dims derived from request via VAE compression: T=2, H=4, W=4.
    // Output dims: T*tcomp=4, H*scomp=8, W*scomp=8.
    expect(result.frames.length).toBe(4);
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    for (const frame of result.frames) {
      expect(frame.length).toBe(8 * 8 * 4); // RGBA
      // Alpha channel always 255.
      for (let p = 3; p < frame.length; p += 4) expect(frame[p]).toBe(255);
    }
    expect(result.elapsedMs).toBeGreaterThan(0);
    await bundle.unload();
  });

  it("calls the progress callback once per scheduler step", async () => {
    const bundle = await loadBundleFromDir(fix.dir);
    const calls: Array<[number, number]> = [];
    await runDenoiseLoop(bundle, {
      prompt: "x",
      frames: 4,
      height: 8,
      width: 8,
      steps: 3,
      seed: 1,
      onProgress: (s, total) => calls.push([s, total]),
    });
    expect(calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    await bundle.unload();
  });

  it("produces deterministic output for the same seed", async () => {
    const bundle = await loadBundleFromDir(fix.dir);
    const a = await runDenoiseLoop(bundle, {
      prompt: "fixed",
      frames: 4,
      height: 8,
      width: 8,
      steps: 2,
      seed: 7,
    });
    const b = await runDenoiseLoop(bundle, {
      prompt: "fixed",
      frames: 4,
      height: 8,
      width: 8,
      steps: 2,
      seed: 7,
    });
    expect(Array.from(a.frames[0]!)).toEqual(Array.from(b.frames[0]!));
    await bundle.unload();
  });

  it("differs across distinct seeds (bundle-load → generate → frames is the only path)", async () => {
    const bundle = await loadBundleFromDir(fix.dir);
    const a = await runDenoiseLoop(bundle, {
      prompt: "x",
      frames: 4,
      height: 8,
      width: 8,
      steps: 2,
      seed: 1,
    });
    const b = await runDenoiseLoop(bundle, {
      prompt: "x",
      frames: 4,
      height: 8,
      width: 8,
      steps: 2,
      seed: 2,
    });
    expect(Array.from(a.frames[0]!)).not.toEqual(Array.from(b.frames[0]!));
    await bundle.unload();
  });
});
