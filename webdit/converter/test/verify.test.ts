import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { ltx2Distilled } from "../src/architectures/ltx";
import { writeBundle } from "../src/bundle-writer";
import { quantize, type QuantizedTensor } from "../src/quantize";
import { summarizeBundle, verifyBundle } from "../src/verify";

async function makeFixtureBundle(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webdit-verify-"));
  const src = path.join(root, "src");
  const out = path.join(root, "out");
  await fs.mkdir(src, { recursive: true });
  await fs.writeFile(path.join(src, "dit.onnx"), "FAKE_DIT");
  await fs.writeFile(path.join(src, "te.onnx"), "FAKE_TE");
  await fs.writeFile(path.join(src, "vae.onnx"), "FAKE_VAE");
  await fs.mkdir(path.join(src, "tokenizer"), { recursive: true });
  await fs.writeFile(path.join(src, "tokenizer/tokenizer.json"), "{}");

  const fakeWeights = (): Map<string, QuantizedTensor> => {
    const data = new Float32Array(64).map((_, i) => (i - 32) / 32);
    return new Map([
      ["block.0.weight", quantize(data, [8, 8], "f16")],
      ["block.0.bias", quantize(new Float32Array(8), [8], "f16")],
    ]);
  };

  await writeBundle({
    output: out,
    manifest: ltx2Distilled.buildManifest("f16"),
    ditWeights: fakeWeights(),
    textEncoderWeights: fakeWeights(),
    vaeWeights: fakeWeights(),
    graphs: {
      dit: path.join(src, "dit.onnx"),
      textEncoder: path.join(src, "te.onnx"),
      vae: path.join(src, "vae.onnx"),
    },
    tokenizerDir: path.join(src, "tokenizer"),
  });

  return {
    dir: out,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

describe("verifyBundle", () => {
  let fix: Awaited<ReturnType<typeof makeFixtureBundle>>;

  beforeEach(async () => {
    fix = await makeFixtureBundle();
  });

  afterEach(() => fix.cleanup());

  it("succeeds end-to-end on a freshly-written bundle", async () => {
    const r = await verifyBundle(fix.dir);
    expect(r.manifest.architecture).toBe("ltx2-distilled");
    expect(r.ditTensorCount).toBe(2);
    expect(r.textEncoderTensorCount).toBe(2);
    expect(r.vaeTensorCount).toBe(2);
    expect(r.totalWeightBytes).toBeGreaterThan(0);
  });

  it("throws if manifest.json is missing", async () => {
    await fs.rm(path.join(fix.dir, "manifest.json"));
    await expect(verifyBundle(fix.dir)).rejects.toThrow(/manifest/);
  });

  it("throws if a declared graph file is missing", async () => {
    await fs.rm(path.join(fix.dir, "graph/dit.onnx"));
    await expect(verifyBundle(fix.dir)).rejects.toThrow(/ditGraph/);
  });

  it("throws if a shard file is missing", async () => {
    await fs.rm(path.join(fix.dir, "weights/text_encoder.bin"));
    await expect(verifyBundle(fix.dir)).rejects.toThrow(/text_encoder/);
  });

  it("throws if a shard file is corrupted", async () => {
    await fs.writeFile(path.join(fix.dir, "weights/vae.bin"), "garbage");
    await expect(verifyBundle(fix.dir)).rejects.toThrow(/malformed/);
  });

  it("throws with the bad path when manifest fails validation", async () => {
    const manifestPath = path.join(fix.dir, "manifest.json");
    const m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    m.architecture = "not-a-real-arch";
    await fs.writeFile(manifestPath, JSON.stringify(m));
    await expect(verifyBundle(fix.dir)).rejects.toThrow(/architecture/);
  });
});

describe("summarizeBundle", () => {
  let fix: Awaited<ReturnType<typeof makeFixtureBundle>>;
  beforeEach(async () => {
    fix = await makeFixtureBundle();
  });
  afterEach(() => fix.cleanup());

  it("includes architecture, quantization, scheduler, and tensor counts", async () => {
    const summary = await summarizeBundle(fix.dir);
    expect(summary).toMatch(/ltx2-distilled/);
    expect(summary).toMatch(/f16/);
    expect(summary).toMatch(/flow-match-rect/);
    expect(summary).toMatch(/dit=2/);
    expect(summary).toMatch(/MB/);
  });
});
