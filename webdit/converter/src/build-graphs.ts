import * as fs from "node:fs/promises";
import * as path from "node:path";
import { renderMiniGraphs } from "./onnx";

export interface BuildGraphsOptions {
  architecture: string;
  output: string;
  /** Optional deterministic seed for synthetic weights (mini-test). */
  seed?: number;
}

export interface BuildGraphsResult {
  files: { dit: string; textEncoder: string; vae: string };
  bytesWritten: number;
}

/**
 * Generates ONNX graphs for an architecture. Today only `mini-test` is
 * supported — the other architectures (LTX/Wan/Mochi/CogVideoX) require
 * upstream ONNX export from PyTorch, which is out of scope for our
 * TS-only stack and tracked as a known external dependency.
 */
export async function buildGraphs(opts: BuildGraphsOptions): Promise<BuildGraphsResult> {
  if (opts.architecture !== "mini-test") {
    throw new Error(
      `build_graphs: only 'mini-test' supports in-repo graph generation. ` +
        `Architecture '${opts.architecture}' requires upstream ONNX export (e.g. via diffusers) ` +
        `before its graphs can be packed into a bundle.`,
    );
  }

  await fs.mkdir(opts.output, { recursive: true });

  const w = synthMiniWeights(opts.seed ?? 0);
  const { dit, textEncoder, vae } = renderMiniGraphs(w, 64, 8, 2, 2);

  const ditPath = path.join(opts.output, "dit.onnx");
  const tePath = path.join(opts.output, "text_encoder.onnx");
  const vaePath = path.join(opts.output, "vae.onnx");
  await Promise.all([
    fs.writeFile(ditPath, dit),
    fs.writeFile(tePath, textEncoder),
    fs.writeFile(vaePath, vae),
  ]);

  return {
    files: { dit: ditPath, textEncoder: tePath, vae: vaePath },
    bytesWritten: dit.byteLength + textEncoder.byteLength + vae.byteLength,
  };
}

function synthMiniWeights(seed: number): {
  ditScale: Float32Array;
  ditBias: Float32Array;
  teProj: Float32Array;
  vaeProj: Float32Array;
} {
  const rng = mulberry32(seed);
  return {
    ditScale: filled(4, () => rng() * 0.5),
    ditBias: filled(4, () => (rng() - 0.5) * 0.2),
    teProj: filled(64 * 8, () => (rng() - 0.5) * 0.4),
    vaeProj: filled(12, () => (rng() - 0.5) * 0.6),
  };
}

function filled(n: number, fn: () => number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = fn();
  return a;
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
