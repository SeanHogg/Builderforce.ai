import { describe, it, expect } from "vitest";
import { getAdapter, listArchitectures } from "../src/architectures";
import { ltx2Distilled } from "../src/architectures/ltx";

describe("architecture registry", () => {
  it("returns the LTX adapter by id", () => {
    expect(getAdapter("ltx2-distilled")).toBe(ltx2Distilled);
  });

  it("lists registered (implemented) architectures, sorted, with no nulls", () => {
    const archs = listArchitectures();
    expect(archs).toContain("ltx2-distilled");
    expect(archs).toEqual([...archs].sort());
  });

  it("does not list architectures that are reserved but unimplemented", () => {
    const archs = listArchitectures();
    expect(archs).not.toContain("wan2.5");
    expect(archs).not.toContain("mochi-1");
  });

  it("throws a helpful error for unknown ids that includes the known list", () => {
    expect(() => getAdapter("not-a-real-arch")).toThrow(/ltx2-distilled/);
  });

  it("throws for known-but-unimplemented architectures (no silent fallback)", () => {
    expect(() => getAdapter("wan2.5")).toThrow(/wan2\.5/);
  });
});

describe("ltx2Distilled.buildManifest", () => {
  it("produces a v1 manifest with the requested quantization", () => {
    const m = ltx2Distilled.buildManifest("q4f16_1");
    expect(m.bundleVersion).toBe(1);
    expect(m.architecture).toBe("ltx2-distilled");
    expect(m.quantization).toBe("q4f16_1");
  });

  it("uses rectified-flow scheduler (LTX training method)", () => {
    expect(ltx2Distilled.buildManifest("f16").scheduler).toBe("flow-match-rect");
  });

  it("declares CLIP-L as the text encoder (T5-XXL is too large for browser)", () => {
    expect(ltx2Distilled.buildManifest("f16").textEncoder.kind).toBe("clip-l");
  });

  it("starts with empty ditWeightShards — bundle writer fills these in", () => {
    expect(ltx2Distilled.buildManifest("f16").files.ditWeightShards).toEqual([]);
  });

  it("declares the LTX VAE compression ratios (32× spatial, 8× temporal)", () => {
    const m = ltx2Distilled.buildManifest("f16");
    expect(m.vaeCompression).toEqual({ spatial: 32, temporal: 8 });
  });
});
