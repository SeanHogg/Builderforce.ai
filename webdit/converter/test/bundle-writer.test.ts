import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { ltx2Distilled } from "../src/architectures/ltx";
import { writeBundle } from "../src/bundle-writer";
import { quantize, type QuantizedTensor } from "../src/quantize";

async function makeFixture(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "webdit-"));
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

async function writeFile(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
}

function fakeWeights(): Map<string, QuantizedTensor> {
  const data = new Float32Array(64);
  for (let i = 0; i < 64; i++) data[i] = (i - 32) / 32;
  return new Map([
    ["block.0.weight", quantize(data, [8, 8], "f16")],
    ["block.0.bias", quantize(new Float32Array(8), [8], "f16")],
  ]);
}

describe("writeBundle", () => {
  let fix: Awaited<ReturnType<typeof makeFixture>>;

  beforeEach(async () => {
    fix = await makeFixture();
    // Pre-populate fake graphs + tokenizer dir so the writer has something to copy.
    await writeFile(path.join(fix.dir, "src/dit.onnx"), "FAKE_DIT_ONNX");
    await writeFile(path.join(fix.dir, "src/text_encoder.onnx"), "FAKE_TE_ONNX");
    await writeFile(path.join(fix.dir, "src/vae.onnx"), "FAKE_VAE_ONNX");
    await writeFile(path.join(fix.dir, "src/tokenizer/tokenizer.json"), "{}");
    await writeFile(path.join(fix.dir, "src/tokenizer/tokenizer_config.json"), "{}");
  });

  afterEach(() => fix.cleanup());

  it("writes manifest.json that round-trips through JSON parse", async () => {
    const out = path.join(fix.dir, "out");
    const manifest = await writeBundle({
      output: out,
      manifest: ltx2Distilled.buildManifest("f16"),
      ditWeights: fakeWeights(),
      textEncoderWeights: fakeWeights(),
      vaeWeights: fakeWeights(),
      graphs: {
        dit: path.join(fix.dir, "src/dit.onnx"),
        textEncoder: path.join(fix.dir, "src/text_encoder.onnx"),
        vae: path.join(fix.dir, "src/vae.onnx"),
      },
      tokenizerDir: path.join(fix.dir, "src/tokenizer"),
    });

    const raw = await fs.readFile(path.join(out, "manifest.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.bundleVersion).toBe(1);
    expect(parsed.architecture).toBe("ltx2-distilled");
    expect(parsed).toEqual(manifest);
  });

  it("populates ditWeightShards based on actual shard count", async () => {
    const out = path.join(fix.dir, "out");
    const manifest = await writeBundle({
      output: out,
      manifest: ltx2Distilled.buildManifest("f16"),
      ditWeights: fakeWeights(),
      textEncoderWeights: fakeWeights(),
      vaeWeights: fakeWeights(),
      graphs: {
        dit: path.join(fix.dir, "src/dit.onnx"),
        textEncoder: path.join(fix.dir, "src/text_encoder.onnx"),
        vae: path.join(fix.dir, "src/vae.onnx"),
      },
      tokenizerDir: path.join(fix.dir, "src/tokenizer"),
    });
    expect(manifest.files.ditWeightShards.length).toBeGreaterThan(0);
    for (const shard of manifest.files.ditWeightShards) {
      const stat = await fs.stat(path.join(out, shard));
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it("splits weights across multiple shards when limit is small", async () => {
    const out = path.join(fix.dir, "out");
    const manifest = await writeBundle({
      output: out,
      manifest: ltx2Distilled.buildManifest("f16"),
      ditWeights: fakeWeights(),
      textEncoderWeights: fakeWeights(),
      vaeWeights: fakeWeights(),
      graphs: {
        dit: path.join(fix.dir, "src/dit.onnx"),
        textEncoder: path.join(fix.dir, "src/text_encoder.onnx"),
        vae: path.join(fix.dir, "src/vae.onnx"),
      },
      tokenizerDir: path.join(fix.dir, "src/tokenizer"),
      shardLimitBytes: 8, // force one tensor per shard
    });
    expect(manifest.files.ditWeightShards.length).toBe(2);
  });

  it("copies graph and tokenizer files into the bundle", async () => {
    const out = path.join(fix.dir, "out");
    await writeBundle({
      output: out,
      manifest: ltx2Distilled.buildManifest("f16"),
      ditWeights: fakeWeights(),
      textEncoderWeights: fakeWeights(),
      vaeWeights: fakeWeights(),
      graphs: {
        dit: path.join(fix.dir, "src/dit.onnx"),
        textEncoder: path.join(fix.dir, "src/text_encoder.onnx"),
        vae: path.join(fix.dir, "src/vae.onnx"),
      },
      tokenizerDir: path.join(fix.dir, "src/tokenizer"),
    });
    expect(await fs.readFile(path.join(out, "graph/dit.onnx"), "utf-8")).toBe("FAKE_DIT_ONNX");
    expect(await fs.readFile(path.join(out, "graph/text_encoder.onnx"), "utf-8")).toBe("FAKE_TE_ONNX");
    expect(await fs.readFile(path.join(out, "graph/vae.onnx"), "utf-8")).toBe("FAKE_VAE_ONNX");
    expect(await fs.readFile(path.join(out, "tokenizer/tokenizer.json"), "utf-8")).toBe("{}");
    expect(await fs.readFile(path.join(out, "tokenizer/tokenizer_config.json"), "utf-8")).toBe("{}");
  });

  it("has no ONNX external-data companions when none are present (self-contained graphs)", async () => {
    const out = path.join(fix.dir, "out");
    const manifest = await writeBundle({
      output: out,
      manifest: ltx2Distilled.buildManifest("f16"),
      ditWeights: fakeWeights(),
      textEncoderWeights: fakeWeights(),
      vaeWeights: fakeWeights(),
      graphs: {
        dit: path.join(fix.dir, "src/dit.onnx"),
        textEncoder: path.join(fix.dir, "src/text_encoder.onnx"),
        vae: path.join(fix.dir, "src/vae.onnx"),
      },
      tokenizerDir: path.join(fix.dir, "src/tokenizer"),
    });
    expect(manifest.files.ditGraphData).toBeUndefined();
    expect(manifest.files.textEncoderGraphData).toBeUndefined();
    expect(manifest.files.vaeGraphData).toBeUndefined();
  });

  it("copies ONNX external-data companions and records them in the manifest — even when the DiT and text-encoder source graphs share a basename (the real diffusers layout: both named `model.onnx`, differing only by parent directory)", async () => {
    // Same basename on purpose — this is what diffusersSourceLayout() actually
    // produces (transformer/model.onnx, text_encoder/model.onnx). Without the
    // per-slot subfolder in bundle-writer's external-data destination, these
    // would collide in the bundle's flat graph/ directory.
    await writeFile(path.join(fix.dir, "src2/transformer/model.onnx"), "FAKE_DIT_ONNX_2");
    await writeFile(path.join(fix.dir, "src2/transformer/model.onnx.data"), "DIT_WEIGHTS_BLOB");
    await writeFile(path.join(fix.dir, "src2/text_encoder/model.onnx"), "FAKE_TE_ONNX_2");
    await writeFile(path.join(fix.dir, "src2/text_encoder/model.onnx.data"), "TE_WEIGHTS_BLOB");

    const out = path.join(fix.dir, "out2");
    const manifest = await writeBundle({
      output: out,
      manifest: ltx2Distilled.buildManifest("f16"),
      ditWeights: fakeWeights(),
      textEncoderWeights: fakeWeights(),
      vaeWeights: fakeWeights(),
      graphs: {
        dit: path.join(fix.dir, "src2/transformer/model.onnx"),
        textEncoder: path.join(fix.dir, "src2/text_encoder/model.onnx"),
        vae: path.join(fix.dir, "src/vae.onnx"), // no companion for vae
      },
      tokenizerDir: path.join(fix.dir, "src/tokenizer"),
    });

    expect(manifest.files.ditGraphData).toBe("graph/dit/model.onnx.data");
    expect(manifest.files.textEncoderGraphData).toBe("graph/text_encoder/model.onnx.data");
    expect(manifest.files.vaeGraphData).toBeUndefined();

    expect(await fs.readFile(path.join(out, manifest.files.ditGraphData!), "utf-8")).toBe(
      "DIT_WEIGHTS_BLOB",
    );
    expect(await fs.readFile(path.join(out, manifest.files.textEncoderGraphData!), "utf-8")).toBe(
      "TE_WEIGHTS_BLOB",
    );
  });
});
