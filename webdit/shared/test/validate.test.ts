import { describe, it, expect } from "vitest";
import { validateManifest, type WebDiTManifest } from "../src/index";

const valid: WebDiTManifest = {
  bundleVersion: 1,
  architecture: "ltx2-distilled",
  quantization: "q4f16_1",
  scheduler: "flow-match-rect",
  latentShape: { c: 128, t: 8, h: 32, w: 32 },
  vaeCompression: { spatial: 32, temporal: 8 },
  patchSize: { d: 1, h: 1, w: 1 },
  textEncoder: { kind: "clip-l", maxTokens: 77, embedDim: 768 },
  defaults: { steps: 8, guidanceScale: 1.0, frames: 121, height: 512, width: 768 },
  files: {
    ditGraph: "graph/dit.onnx",
    ditWeightShards: ["weights/dit_shard_0.bin"],
    textEncoderGraph: "graph/text_encoder.onnx",
    textEncoderWeights: "weights/text_encoder.bin",
    vaeGraph: "graph/vae.onnx",
    vaeWeights: "weights/vae.bin",
    tokenizer: "tokenizer/",
  },
};

function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(valid));
}

describe("validateManifest", () => {
  it("accepts a well-formed manifest and returns the same value", () => {
    expect(validateManifest(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it("rejects non-object input", () => {
    expect(() => validateManifest(null)).toThrow(/manifest:/);
    expect(() => validateManifest("string")).toThrow(/manifest:/);
    expect(() => validateManifest([])).toThrow(/manifest:/);
  });

  it("rejects bundleVersion !== 1", () => {
    const m = clone();
    m.bundleVersion = 2;
    expect(() => validateManifest(m)).toThrow(/bundleVersion/);
  });

  it("rejects unknown architecture with the known list in the message", () => {
    const m = clone();
    m.architecture = "stable-video-diffusion";
    expect(() => validateManifest(m)).toThrow(/architecture/);
    expect(() => validateManifest(m)).toThrow(/ltx2-distilled/);
  });

  it("rejects unknown quantization", () => {
    const m = clone();
    m.quantization = "fp8";
    expect(() => validateManifest(m)).toThrow(/quantization/);
  });

  it("rejects unknown scheduler", () => {
    const m = clone();
    m.scheduler = "ddim";
    expect(() => validateManifest(m)).toThrow(/scheduler/);
  });

  it("pinpoints missing nested fields by full path", () => {
    const m = clone();
    delete (m.latentShape as Record<string, unknown>).c;
    expect(() => validateManifest(m)).toThrow(/manifest\.latentShape\.c/);
  });

  it("rejects non-finite numbers (NaN, Infinity)", () => {
    const m = clone();
    (m.defaults as Record<string, unknown>).steps = NaN;
    expect(() => validateManifest(m)).toThrow(/defaults\.steps/);
  });

  it("rejects non-array ditWeightShards", () => {
    const m = clone();
    (m.files as Record<string, unknown>).ditWeightShards = "not-an-array";
    expect(() => validateManifest(m)).toThrow(/ditWeightShards/);
  });

  it("validates each shard path is a string", () => {
    const m = clone();
    (m.files as Record<string, unknown>).ditWeightShards = ["ok.bin", 42];
    expect(() => validateManifest(m)).toThrow(/ditWeightShards\[1\]/);
  });

  it("rejects unknown text encoder kind", () => {
    const m = clone();
    (m.textEncoder as Record<string, unknown>).kind = "bert-base";
    expect(() => validateManifest(m)).toThrow(/textEncoder\.kind/);
  });
});
