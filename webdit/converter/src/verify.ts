import * as fs from "node:fs/promises";
import * as path from "node:path";
import { validateManifest, type WebDiTManifest } from "@webdit/shared";
import { parseBundleShard, type ShardSummary } from "./shard-format";

export interface VerifyResult {
  manifest: WebDiTManifest;
  /** Component → bytes for that component's weight file(s). */
  shardSizes: Map<string, number>;
  totalWeightBytes: number;
  ditTensorCount: number;
  textEncoderTensorCount: number;
  vaeTensorCount: number;
}

/**
 * Reads a bundle from disk and validates it end-to-end:
 *   - manifest.json parses + passes validateManifest
 *   - graphs and tokenizer dir exist at declared paths
 *   - every weight shard parses without throwing and matches its declared format
 *
 * Throws on any failure with a path that pinpoints the problem.
 */
export async function verifyBundle(bundleDir: string): Promise<VerifyResult> {
  const manifest = await readAndValidateManifest(bundleDir);

  await Promise.all([
    assertExists(path.join(bundleDir, manifest.files.ditGraph), "files.ditGraph"),
    assertExists(path.join(bundleDir, manifest.files.textEncoderGraph), "files.textEncoderGraph"),
    assertExists(path.join(bundleDir, manifest.files.vaeGraph), "files.vaeGraph"),
    assertExists(path.join(bundleDir, manifest.files.tokenizer), "files.tokenizer"),
  ]);

  const shardSizes = new Map<string, number>();
  let totalWeightBytes = 0;
  let ditTensorCount = 0;
  for (const shard of manifest.files.ditWeightShards) {
    const summary = await readShard(bundleDir, shard);
    shardSizes.set(shard, summary.totalBytes);
    totalWeightBytes += summary.totalBytes;
    ditTensorCount += summary.tensors.size;
  }

  const teSummary = await readShard(bundleDir, manifest.files.textEncoderWeights);
  shardSizes.set(manifest.files.textEncoderWeights, teSummary.totalBytes);
  totalWeightBytes += teSummary.totalBytes;

  const vaeSummary = await readShard(bundleDir, manifest.files.vaeWeights);
  shardSizes.set(manifest.files.vaeWeights, vaeSummary.totalBytes);
  totalWeightBytes += vaeSummary.totalBytes;

  return {
    manifest,
    shardSizes,
    totalWeightBytes,
    ditTensorCount,
    textEncoderTensorCount: teSummary.tensors.size,
    vaeTensorCount: vaeSummary.tensors.size,
  };
}

export async function summarizeBundle(bundleDir: string): Promise<string> {
  const r = await verifyBundle(bundleDir);
  const { manifest, totalWeightBytes } = r;
  const totalTensors = r.ditTensorCount + r.textEncoderTensorCount + r.vaeTensorCount;
  return [
    `Bundle: ${bundleDir}`,
    `  Architecture     : ${manifest.architecture}`,
    `  Quantization     : ${manifest.quantization}`,
    `  Scheduler        : ${manifest.scheduler}`,
    `  Latent channels  : ${manifest.latentShape.c}`,
    `  VAE compression  : ${manifest.vaeCompression.spatial}x spatial, ${manifest.vaeCompression.temporal}x temporal`,
    `  Text encoder     : ${manifest.textEncoder.kind} (max ${manifest.textEncoder.maxTokens} tokens)`,
    `  Defaults         : ${manifest.defaults.frames} frames @ ${manifest.defaults.height}x${manifest.defaults.width}, ${manifest.defaults.steps} steps, cfg ${manifest.defaults.guidanceScale}`,
    `  DiT shards       : ${manifest.files.ditWeightShards.length}`,
    `  Tensor counts    : dit=${r.ditTensorCount}, text=${r.textEncoderTensorCount}, vae=${r.vaeTensorCount} (total ${totalTensors})`,
    `  Weight bytes     : ${(totalWeightBytes / (1024 * 1024)).toFixed(2)} MB`,
  ].join("\n");
}

async function readAndValidateManifest(bundleDir: string): Promise<WebDiTManifest> {
  const manifestPath = path.join(bundleDir, "manifest.json");
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  } catch (e) {
    throw new Error(`verify: failed to read manifest at ${manifestPath}: ${(e as Error).message}`);
  }
  return validateManifest(raw);
}

async function readShard(bundleDir: string, relPath: string): Promise<ShardSummary> {
  const full = path.join(bundleDir, relPath);
  let buf: Uint8Array;
  try {
    buf = await fs.readFile(full);
  } catch (e) {
    throw new Error(`verify: failed to read shard ${relPath}: ${(e as Error).message}`);
  }
  try {
    return parseBundleShard(buf);
  } catch (e) {
    throw new Error(`verify: shard ${relPath} is malformed: ${(e as Error).message}`);
  }
}

async function assertExists(p: string, label: string): Promise<void> {
  try {
    await fs.stat(p);
  } catch {
    throw new Error(`verify: ${label} missing at ${p}`);
  }
}
