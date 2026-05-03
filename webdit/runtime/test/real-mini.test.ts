import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { quantize, type QuantizedTensor, realMini, writeBundle } from "@webdit/convert";
import { REAL_MINI_CONFIG } from "../src/torch-arch/real-mini";
import { loadBundleFromDir } from "../src/bundle";
import { runDenoiseLoop } from "../src/ort-runner";

/**
 * End-to-end test for the real DiT architecture: real RoPE, real multi-head
 * attention, real transformer blocks, real timestep + text conditioning. The
 * bundle is built fresh on disk, loaded via the torch backend, and run
 * through the same denoise loop production uses.
 */

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

function randn(rng: () => number, n: number, scale = 0.1): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1)) * scale;
    out[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

function quant(data: Float32Array, shape: number[]): QuantizedTensor {
  return quantize(data, shape, "f16");
}

function ones(n: number): Float32Array {
  const out = new Float32Array(n);
  out.fill(1);
  return out;
}

function zeros(n: number): Float32Array {
  return new Float32Array(n);
}

function buildSyntheticDitWeights(seed: number): Map<string, QuantizedTensor> {
  const cfg = REAL_MINI_CONFIG;
  const D = cfg.hiddenDim;
  const C = cfg.latentChannels;
  const tDim = cfg.timestepInDim;
  const rng = mulberry32(seed);

  const weights = new Map<string, QuantizedTensor>();
  weights.set("in_proj.weight", quant(randn(rng, D * C), [D, C]));
  weights.set("in_proj.bias", quant(zeros(D), [D]));
  weights.set("out_proj.weight", quant(randn(rng, C * D), [C, D]));
  weights.set("out_proj.bias", quant(zeros(C), [C]));
  weights.set("final_norm.gamma", quant(ones(D), [D]));
  weights.set("final_norm.beta", quant(zeros(D), [D]));
  weights.set("t_emb.proj1.weight", quant(randn(rng, D * tDim), [D, tDim]));
  weights.set("t_emb.proj1.bias", quant(zeros(D), [D]));
  weights.set("t_emb.proj2.weight", quant(randn(rng, D * D), [D, D]));
  weights.set("t_emb.proj2.bias", quant(zeros(D), [D]));
  weights.set("text_pool.weight", quant(randn(rng, D * cfg.textDim), [D, cfg.textDim]));
  weights.set("text_pool.bias", quant(zeros(D), [D]));

  for (let i = 0; i < cfg.numBlocks; i++) {
    const prefix = `block${i}`;
    weights.set(`${prefix}.norm1.gamma`, quant(ones(D), [D]));
    weights.set(`${prefix}.norm1.beta`, quant(zeros(D), [D]));
    weights.set(`${prefix}.norm2.gamma`, quant(ones(D), [D]));
    weights.set(`${prefix}.norm2.beta`, quant(zeros(D), [D]));
    weights.set(`${prefix}.q.weight`, quant(randn(rng, D * D), [D, D]));
    weights.set(`${prefix}.q.bias`, quant(zeros(D), [D]));
    weights.set(`${prefix}.k.weight`, quant(randn(rng, D * D), [D, D]));
    weights.set(`${prefix}.k.bias`, quant(zeros(D), [D]));
    weights.set(`${prefix}.v.weight`, quant(randn(rng, D * D), [D, D]));
    weights.set(`${prefix}.v.bias`, quant(zeros(D), [D]));
    weights.set(`${prefix}.attn_out.weight`, quant(randn(rng, D * D), [D, D]));
    weights.set(`${prefix}.attn_out.bias`, quant(zeros(D), [D]));
    weights.set(`${prefix}.mlp_up.weight`, quant(randn(rng, 4 * D * D), [4 * D, D]));
    weights.set(`${prefix}.mlp_up.bias`, quant(zeros(4 * D), [4 * D]));
    weights.set(`${prefix}.mlp_down.weight`, quant(randn(rng, D * 4 * D), [D, 4 * D]));
    weights.set(`${prefix}.mlp_down.bias`, quant(zeros(D), [D]));
  }
  return weights;
}

async function buildRealMiniBundle(seed: number): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const cfg = REAL_MINI_CONFIG;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webdit-realmini-"));
  const out = path.join(root, "bundle");
  const stub = path.join(root, "stub");
  await fs.mkdir(stub, { recursive: true });
  // Bundle writer requires graph + tokenizer files to exist (it copies them).
  await fs.writeFile(path.join(stub, "dit.onnx"), "STUB");
  await fs.writeFile(path.join(stub, "te.onnx"), "STUB");
  await fs.writeFile(path.join(stub, "vae.onnx"), "STUB");
  await fs.mkdir(path.join(stub, "tokenizer"), { recursive: true });
  await fs.writeFile(path.join(stub, "tokenizer/tokenizer.json"), "{}");

  const ditWeights = buildSyntheticDitWeights(seed);
  const teWeights = new Map<string, QuantizedTensor>([
    ["vocab", quant(randn(mulberry32(seed + 1), 64 * cfg.textDim, 0.5), [64, cfg.textDim])],
  ]);
  const vaeWeights = new Map<string, QuantizedTensor>([
    ["proj", quant(randn(mulberry32(seed + 2), 3 * cfg.latentChannels, 0.5), [3, cfg.latentChannels])],
  ]);

  await writeBundle({
    output: out,
    manifest: realMini.buildManifest("f16"),
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

  return { dir: out, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

describe("real-mini end-to-end (real DiT through @webdit/torch)", () => {
  let fix: Awaited<ReturnType<typeof buildRealMiniBundle>>;

  beforeEach(async () => {
    fix = await buildRealMiniBundle(42);
  });

  afterEach(() => fix.cleanup());

  it("loads a torch-backend bundle and reports correct manifest fields", async () => {
    const bundle = await loadBundleFromDir(fix.dir);
    expect(bundle.manifest.architecture).toBe("real-mini");
    expect(bundle.manifest.backend).toBe("torch");
    expect(bundle.manifest.scheduler).toBe("flow-match-rect");
    await bundle.unload();
  });

  it("generates frames through real transformer forward passes", async () => {
    const bundle = await loadBundleFromDir(fix.dir);
    const result = await runDenoiseLoop(bundle, {
      prompt: "test prompt",
      frames: 2,
      height: 4,
      width: 4,
      steps: 2,
      seed: 7,
    });
    expect(result.frames.length).toBe(2);
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    for (const frame of result.frames) {
      expect(frame.length).toBe(4 * 4 * 4);
      // Alpha channel always 255.
      for (let p = 3; p < frame.length; p += 4) expect(frame[p]).toBe(255);
      // RGB are valid bytes.
      for (let p = 0; p < frame.length; p += 4) {
        expect(frame[p]!).toBeGreaterThanOrEqual(0);
        expect(frame[p]!).toBeLessThanOrEqual(255);
      }
    }
    expect(result.elapsedMs).toBeGreaterThan(0);
    await bundle.unload();
  });

  it("is deterministic for the same seed", async () => {
    const bundle = await loadBundleFromDir(fix.dir);
    const a = await runDenoiseLoop(bundle, {
      prompt: "fixed", frames: 2, height: 4, width: 4, steps: 2, seed: 1,
    });
    const b = await runDenoiseLoop(bundle, {
      prompt: "fixed", frames: 2, height: 4, width: 4, steps: 2, seed: 1,
    });
    expect(Array.from(a.frames[0]!)).toEqual(Array.from(b.frames[0]!));
    await bundle.unload();
  });

  it("differs across distinct prompts (text actually conditions the output)", async () => {
    const bundle = await loadBundleFromDir(fix.dir);
    const a = await runDenoiseLoop(bundle, {
      prompt: "abc", frames: 2, height: 4, width: 4, steps: 2, seed: 1,
    });
    const b = await runDenoiseLoop(bundle, {
      prompt: "xyz different prompt", frames: 2, height: 4, width: 4, steps: 2, seed: 1,
    });
    // At least some pixel differs.
    let anyDiff = false;
    for (let i = 0; i < a.frames[0]!.length; i++) {
      if (a.frames[0]![i] !== b.frames[0]![i]) {
        anyDiff = true;
        break;
      }
    }
    expect(anyDiff).toBe(true);
    await bundle.unload();
  });
});
