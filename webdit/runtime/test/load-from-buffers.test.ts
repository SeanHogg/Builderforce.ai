import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { miniTest, quantize, writeBundle, type QuantizedTensor } from "@webdit/convert";
import type { WebDiTManifest } from "@webdit/shared";
import { loadBundleFromBuffers } from "../src/bundle";
import { runDenoiseLoop } from "../src/ort-runner";

/**
 * `loadBundleFromBuffers` is the loader studio's webdit-engine.ts uses: every
 * bundle file is routed through studio's own IndexedDB-backed weight cache
 * first, then handed to the runtime as an in-memory buffer map instead of a
 * URL/directory the runtime fetches itself. This test builds the same
 * synthetic mini-test bundle `test/integration.test.ts` builds (same
 * fixture-building approach: write real quantized shards to a temp dir via
 * the real `writeBundle`), but instead of loading it with `loadBundleFromDir`
 * (which does its own fs reads), reads every manifest-referenced file back
 * into a buffer map itself and feeds that to `loadBundleFromBuffers` — no
 * temp dir or URL involved at LOAD time, only at fixture-build time.
 */
async function buildMiniBundleBuffers(): Promise<{
  manifest: WebDiTManifest;
  files: Record<string, ArrayBuffer>;
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webdit-buf-"));
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

  const manifest = await writeBundle({
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

  // Read every file the manifest names into an in-memory buffer map — the
  // "already fetched" shape loadBundleFromBuffers expects. The "mini" backend
  // never reads tokenizer files (built-in deterministic tokenizer), so they
  // are deliberately NOT included here — this also exercises that the mini
  // path doesn't require them.
  const relPaths = [
    manifest.files.ditGraph,
    ...manifest.files.ditWeightShards,
    manifest.files.textEncoderGraph,
    manifest.files.textEncoderWeights,
    manifest.files.vaeGraph,
    manifest.files.vaeWeights,
  ];
  const files: Record<string, ArrayBuffer> = {};
  for (const rel of relPaths) {
    const buf = await fs.readFile(path.join(out, rel));
    files[rel] = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  return {
    manifest,
    files,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

describe("loadBundleFromBuffers: mini bundle loaded from an in-memory buffer map", () => {
  let fix: Awaited<ReturnType<typeof buildMiniBundleBuffers>>;

  beforeEach(async () => {
    fix = await buildMiniBundleBuffers();
  });

  afterEach(() => fix.cleanup());

  it("produces frames of the right shape from a buffer-sourced bundle", async () => {
    const bundle = await loadBundleFromBuffers(fix.manifest, fix.files);
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

  it("produces deterministic output for the same seed", async () => {
    const bundle = await loadBundleFromBuffers(fix.manifest, fix.files);
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

  it("throws a clear, actionable error when a manifest-referenced file is missing from the buffer map", async () => {
    const incomplete = { ...fix.files };
    delete incomplete[fix.manifest.files.vaeWeights];
    await expect(loadBundleFromBuffers(fix.manifest, incomplete)).rejects.toThrow(
      new RegExp(`missing file '${fix.manifest.files.vaeWeights}'`),
    );
  });
});
