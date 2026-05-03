import { describe, it, expect } from "vitest";
import { validateManifest } from "@webdit/shared";
import { getAdapter, listArchitectures } from "../src/architectures";
import { ltx2Distilled } from "../src/architectures/ltx";
import { wan25 } from "../src/architectures/wan";
import { mochi1 } from "../src/architectures/mochi";
import { cogvideox2b } from "../src/architectures/cogvideox";
import {
  buildManifestWith,
  defaultBundleFiles,
  diffusersSourceLayout,
} from "../src/architectures/defaults";

describe("architecture registry", () => {
  it("returns each adapter by id", () => {
    expect(getAdapter("ltx2-distilled")).toBe(ltx2Distilled);
    expect(getAdapter("wan2.5")).toBe(wan25);
    expect(getAdapter("mochi-1")).toBe(mochi1);
    expect(getAdapter("cogvideox-2b")).toBe(cogvideox2b);
  });

  it("lists all four architectures sorted", () => {
    const archs = listArchitectures();
    expect(archs).toEqual([...archs].sort());
    expect(archs).toEqual(["cogvideox-2b", "ltx2-distilled", "mochi-1", "wan2.5"]);
  });

  it("throws a helpful error for unknown ids that includes the known list", () => {
    expect(() => getAdapter("not-a-real-arch")).toThrow(/ltx2-distilled/);
  });
});

describe("every adapter produces a manifest that passes validateManifest", () => {
  for (const adapter of [ltx2Distilled, wan25, mochi1, cogvideox2b]) {
    it(`${adapter.id} → valid manifest`, () => {
      const m = adapter.buildManifest("q4f16_1");
      expect(() => validateManifest(m)).not.toThrow();
      expect(m.architecture).toBe(adapter.id);
    });
  }
});

describe("ltx2Distilled uses rectified-flow scheduler", () => {
  it("matches LTX training method", () => {
    expect(ltx2Distilled.buildManifest("f16").scheduler).toBe("flow-match-rect");
  });
});

describe("cogvideox2b uses Euler scheduler (DDIM-style training)", () => {
  it("matches CogVideoX training parameterization", () => {
    expect(cogvideox2b.buildManifest("f16").scheduler).toBe("euler");
  });
});

describe("shared adapter helpers (DRY)", () => {
  it("diffusersSourceLayout is reused by every adapter", () => {
    const layout = diffusersSourceLayout();
    for (const adapter of [ltx2Distilled, wan25, mochi1, cogvideox2b]) {
      expect(adapter.expectedSourceLayout()).toEqual(layout);
    }
  });

  it("defaultBundleFiles populates all required output paths", () => {
    const files = defaultBundleFiles();
    expect(files.ditGraph).toBeTruthy();
    expect(files.textEncoderGraph).toBeTruthy();
    expect(files.vaeGraph).toBeTruthy();
    expect(files.tokenizer).toBeTruthy();
    expect(files.ditWeightShards).toEqual([]);
  });

  it("buildManifestWith merges spec into a v1 manifest with the requested quant", () => {
    const m = buildManifestWith(
      {
        architecture: "ltx2-distilled",
        scheduler: "flow-match-rect",
        latentShape: { c: 1, t: 1, h: 1, w: 1 },
        vaeCompression: { spatial: 1, temporal: 1 },
        patchSize: { d: 1, h: 1, w: 1 },
        textEncoder: { kind: "clip-l", maxTokens: 1, embedDim: 1 },
        defaults: { steps: 1, guidanceScale: 1, frames: 1, height: 1, width: 1 },
      },
      "q8f16_0",
    );
    expect(m.bundleVersion).toBe(1);
    expect(m.quantization).toBe("q8f16_0");
    expect(m.files).toMatchObject(defaultBundleFiles());
  });
});
