import { describe, it, expect } from "vitest";
import {
  buildMiniDitGraph,
  buildMiniTextEncoderGraph,
  buildMiniVaeGraph,
  renderMiniGraphs,
} from "../src/onnx/architectures/mini";
import { decodeModel } from "../src/onnx/decode";
import { TensorDataType } from "../src/onnx/types";

describe("mini DiT graph", () => {
  const bytes = buildMiniDitGraph(
    new Float32Array([0.5, 0.4, 0.3, 0.2]),
    new Float32Array([0.0, 0.1, 0.0, -0.1]),
  );
  const model = decodeModel(bytes);

  it("declares the BUNDLE_IO inputs (latent, timestep, text_emb)", () => {
    const inputs = model.graph.inputs.map((i) => i.name);
    expect(inputs).toEqual(["latent", "timestep", "text_emb"]);
  });

  it("declares the BUNDLE_IO output (velocity)", () => {
    expect(model.graph.outputs.map((o) => o.name)).toEqual(["velocity"]);
  });

  it("uses Mul + Add to apply scale and bias", () => {
    const ops = model.graph.nodes.map((n) => n.opType);
    expect(ops).toEqual(["Mul", "Add"]);
  });

  it("ships scale and bias as initializers", () => {
    const names = model.graph.initializers.map((t) => t.name).sort();
    expect(names).toEqual(["bias", "scale"]);
  });

  it("rejects scale/bias with the wrong length", () => {
    expect(() => buildMiniDitGraph(new Float32Array(3), new Float32Array(4))).toThrow();
    expect(() => buildMiniDitGraph(new Float32Array(4), new Float32Array(5))).toThrow();
  });
});

describe("mini text encoder graph", () => {
  const proj = new Float32Array(64 * 8);
  for (let i = 0; i < proj.length; i++) proj[i] = i / proj.length;
  const model = decodeModel(buildMiniTextEncoderGraph(proj, 64, 8));

  it("declares BUNDLE_IO text-encoder inputs (input_ids, attention_mask)", () => {
    expect(model.graph.inputs.map((i) => i.name)).toEqual(["input_ids", "attention_mask"]);
  });

  it("declares BUNDLE_IO output (text_emb)", () => {
    expect(model.graph.outputs.map((o) => o.name)).toEqual(["text_emb"]);
  });

  it("uses a single Gather op for the embedding lookup", () => {
    expect(model.graph.nodes.map((n) => n.opType)).toEqual(["Gather"]);
  });

  it("input_ids is INT64 and attention_mask is INT64", () => {
    const byName = new Map(model.graph.inputs.map((i) => [i.name, i]));
    expect(byName.get("input_ids")!.dtype).toBe(TensorDataType.INT64);
    expect(byName.get("attention_mask")!.dtype).toBe(TensorDataType.INT64);
  });

  it("rejects mismatched proj length", () => {
    expect(() => buildMiniTextEncoderGraph(new Float32Array(10), 64, 8)).toThrow(
      /vocab\*embedDim/,
    );
  });
});

describe("mini VAE graph", () => {
  const proj = new Float32Array(12);
  for (let i = 0; i < 12; i++) proj[i] = i / 12;
  const model = decodeModel(buildMiniVaeGraph(proj, 2, 2));

  it("declares BUNDLE_IO vae input/output (latent, pixels)", () => {
    expect(model.graph.inputs.map((i) => i.name)).toEqual(["latent"]);
    expect(model.graph.outputs.map((o) => o.name)).toEqual(["pixels"]);
  });

  it("uses Conv → Resize → Tanh", () => {
    expect(model.graph.nodes.map((n) => n.opType)).toEqual(["Conv", "Resize", "Tanh"]);
  });

  it("conv kernel is shape [3, 4, 1, 1, 1] (1x1x1 projection)", () => {
    const conv = model.graph.initializers.find((t) => t.name === "conv_w")!;
    expect(conv.shape).toEqual([3, 4, 1, 1, 1]);
  });

  it("rejects a vae.proj that is not exactly 12 elements", () => {
    expect(() => buildMiniVaeGraph(new Float32Array(11), 2, 2)).toThrow(/12/);
  });
});

describe("renderMiniGraphs", () => {
  it("returns three non-empty graphs", () => {
    const w = {
      ditScale: new Float32Array([0.5, 0.4, 0.3, 0.2]),
      ditBias: new Float32Array([0, 0.1, 0, -0.1]),
      teProj: new Float32Array(64 * 8),
      vaeProj: new Float32Array(12),
    };
    const r = renderMiniGraphs(w, 64, 8, 2, 2);
    expect(r.dit.byteLength).toBeGreaterThan(0);
    expect(r.textEncoder.byteLength).toBeGreaterThan(0);
    expect(r.vae.byteLength).toBeGreaterThan(0);
  });
});
