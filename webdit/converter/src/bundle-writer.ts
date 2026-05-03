import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { WebDiTManifest } from "@webdit/shared";
import type { QuantizedTensor } from "./quantize";

export const DEFAULT_SHARD_LIMIT_BYTES = 256 * 1024 * 1024;

export interface BundleInputs {
  output: string;
  manifest: WebDiTManifest;
  ditWeights: Map<string, QuantizedTensor>;
  textEncoderWeights: Map<string, QuantizedTensor>;
  vaeWeights: Map<string, QuantizedTensor>;
  graphs: { dit: string; textEncoder: string; vae: string };
  tokenizerDir: string;
  shardLimitBytes?: number;
}

interface PackedShard {
  bytes: Uint8Array;
  tensorNames: string[];
}

/**
 * Pack/shard quantized weights and write a WebDiT bundle to disk.
 * `manifest.files.ditWeightShards` is rewritten to match the actual shards
 * produced — caller can pass any placeholder.
 */
export async function writeBundle(inputs: BundleInputs): Promise<WebDiTManifest> {
  const shardLimit = inputs.shardLimitBytes ?? DEFAULT_SHARD_LIMIT_BYTES;

  await mkdirs(inputs.output, ["weights", "graph", "tokenizer"]);

  const ditShards = packShards(inputs.ditWeights, shardLimit);
  const teShard = packSingleShard(inputs.textEncoderWeights);
  const vaeShard = packSingleShard(inputs.vaeWeights);

  const ditShardPaths = ditShards.map((_, i) => `weights/dit_shard_${i}.bin`);
  const finalManifest: WebDiTManifest = {
    ...inputs.manifest,
    files: { ...inputs.manifest.files, ditWeightShards: ditShardPaths },
  };

  await Promise.all([
    fs.copyFile(inputs.graphs.dit, path.join(inputs.output, finalManifest.files.ditGraph)),
    fs.copyFile(inputs.graphs.textEncoder, path.join(inputs.output, finalManifest.files.textEncoderGraph)),
    fs.copyFile(inputs.graphs.vae, path.join(inputs.output, finalManifest.files.vaeGraph)),
    fs.writeFile(path.join(inputs.output, finalManifest.files.textEncoderWeights), teShard.bytes),
    fs.writeFile(path.join(inputs.output, finalManifest.files.vaeWeights), vaeShard.bytes),
    ...ditShards.map((s, i) =>
      fs.writeFile(path.join(inputs.output, ditShardPaths[i]!), s.bytes),
    ),
    copyDir(inputs.tokenizerDir, path.join(inputs.output, finalManifest.files.tokenizer)),
  ]);

  await fs.writeFile(
    path.join(inputs.output, "manifest.json"),
    JSON.stringify(finalManifest, null, 2),
  );

  return finalManifest;
}

async function mkdirs(root: string, subdirs: string[]): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await Promise.all(subdirs.map((s) => fs.mkdir(path.join(root, s), { recursive: true })));
}

async function copyDir(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  await Promise.all(
    entries.map((e) => {
      const src = path.join(from, e.name);
      const dst = path.join(to, e.name);
      return e.isDirectory() ? copyDir(src, dst) : fs.copyFile(src, dst);
    }),
  );
}

function packShards(
  tensors: Map<string, QuantizedTensor>,
  limitBytes: number,
): PackedShard[] {
  const entries = Array.from(tensors.entries());
  const shards: PackedShard[] = [];
  let current: Array<[string, QuantizedTensor]> = [];
  let currentSize = 0;

  for (const entry of entries) {
    const size = entry[1].data.byteLength + entry[1].scales.byteLength;
    if (current.length > 0 && currentSize + size > limitBytes) {
      shards.push(packShard(current));
      current = [];
      currentSize = 0;
    }
    current.push(entry);
    currentSize += size;
  }
  if (current.length > 0) shards.push(packShard(current));
  return shards;
}

function packSingleShard(tensors: Map<string, QuantizedTensor>): PackedShard {
  return packShard(Array.from(tensors.entries()));
}

/**
 * Shard format (safetensors-inspired):
 *   8 bytes:  little-endian uint64 header length
 *   N bytes:  JSON header { name: { dtype, shape, quantization, data: [start, end], scales: [start, end] } }
 *   M bytes:  raw concatenated data + scales
 */
function packShard(entries: Array<[string, QuantizedTensor]>): PackedShard {
  const header: Record<string, {
    dtype: "uint8";
    shape: readonly number[];
    quantization: string;
    data: [number, number];
    scales: [number, number];
  }> = {};

  let offset = 0;
  const blobs: Uint8Array[] = [];
  for (const [name, t] of entries) {
    const dataStart = offset;
    const dataEnd = dataStart + t.data.byteLength;
    const scaleStart = dataEnd;
    const scaleEnd = scaleStart + t.scales.byteLength;
    header[name] = {
      dtype: "uint8",
      shape: t.shape,
      quantization: t.quantization,
      data: [dataStart, dataEnd],
      scales: [scaleStart, scaleEnd],
    };
    blobs.push(t.data);
    blobs.push(new Uint8Array(t.scales.buffer, t.scales.byteOffset, t.scales.byteLength));
    offset = scaleEnd;
  }

  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const totalDataLen = blobs.reduce((sum, b) => sum + b.byteLength, 0);
  const out = new Uint8Array(8 + headerBytes.byteLength + totalDataLen);
  new DataView(out.buffer).setBigUint64(0, BigInt(headerBytes.byteLength), true);
  out.set(headerBytes, 8);
  let cursor = 8 + headerBytes.byteLength;
  for (const b of blobs) {
    out.set(b, cursor);
    cursor += b.byteLength;
  }
  return { bytes: out, tensorNames: Object.keys(header) };
}
