import * as fs from "node:fs/promises";
import * as path from "node:path";
import { validateManifest, type WebDiTManifest } from "@webdit/shared";
import type { QuantizedTensor } from "./quantize";
import { packShard, type PackedShard } from "./shard-format";

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

  // A graph whose embedded weights exceed ONNX's ~2GB single-protobuf-file
  // limit is exported with an external-data companion — by convention,
  // `<graph>.data` sitting next to the .onnx file itself (see the exporter
  // that produced `inputs.graphs.*`). Detect + carry each one through to
  // `manifest.files.*GraphData` (see the shared type's doc comment) so the
  // runtime knows to fetch it and hand it to ORT-Web's `externalData` option.
  const [ditGraphData, textEncoderGraphData, vaeGraphData] = await Promise.all([
    externalDataRelPath(inputs.graphs.dit, "dit"),
    externalDataRelPath(inputs.graphs.textEncoder, "text_encoder"),
    externalDataRelPath(inputs.graphs.vae, "vae"),
  ]);

  const finalManifest: WebDiTManifest = validateManifest({
    ...inputs.manifest,
    files: {
      ...inputs.manifest.files,
      ditWeightShards: ditShardPaths,
      ditGraphData,
      textEncoderGraphData,
      vaeGraphData,
    },
  });

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
    copyExternalData(inputs.graphs.dit, ditGraphData, inputs.output),
    copyExternalData(inputs.graphs.textEncoder, textEncoderGraphData, inputs.output),
    copyExternalData(inputs.graphs.vae, vaeGraphData, inputs.output),
  ]);

  await fs.writeFile(
    path.join(inputs.output, "manifest.json"),
    JSON.stringify(finalManifest, null, 2),
  );

  return finalManifest;
}

/**
 * `<graphSrcPath>.data` next to the source graph, if present — returns the
 * bundle-relative path it should land at, or `undefined` if there's no
 * companion (the graph is self-contained).
 *
 * Lands at `graph/<slot>/<basename>.data`, namespaced by `slot` — NOT a flat
 * `graph/<basename>.data` — because two source graphs can legitimately share
 * a basename (the HF `diffusers` layout names both the DiT and the text
 * encoder graph `model.onnx`, differing only by parent directory; see
 * `defaults.ts`'s `diffusersSourceLayout`), and bundle-writer only ever
 * COPIES bytes — it never rewrites the ONNX protobuf, so the exporter's
 * embedded `location` string (its own external-data file's basename — e.g.
 * torch.onnx.export's default is `<exported-filename>.data`) stays whatever
 * it was at export time. Two same-named companions would collide in a flat
 * `graph/` directory; the `slot` subfolder keeps them apart. This is safe
 * because ORT-Web's `externalData` lookup is scoped per-`InferenceSession`
 * (see `runtime/src/bundle.ts`) — the dit session and the text-encoder
 * session can each independently resolve a same-named "model.onnx.data" key
 * against their OWN bytes without conflict; only the bundle's on-disk/R2
 * storage path needs to be unique, not the logical name ORT sees.
 */
async function externalDataRelPath(
  graphSrcPath: string,
  slot: "dit" | "text_encoder" | "vae",
): Promise<string | undefined> {
  try {
    await fs.access(graphSrcPath + ".data");
    return `graph/${slot}/${path.basename(graphSrcPath)}.data`;
  } catch {
    return undefined;
  }
}

async function copyExternalData(
  graphSrcPath: string,
  destRelPath: string | undefined,
  output: string,
): Promise<void> {
  if (!destRelPath) return;
  const dest = path.join(output, destRelPath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(graphSrcPath + ".data", dest);
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
