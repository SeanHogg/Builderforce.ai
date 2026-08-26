import { validateManifest, type QuantizedTensor, type WebDiTManifest } from "@webdit/shared";
import type { DitRunner, TextEncoderRunner, VaeRunner } from "./runners";

/** Minimal tokenizer surface the runtime depends on.
 *  `maxLength`, when given, pads/truncates to EXACTLY that many tokens —
 *  required by architectures with a learned (non-rotary) absolute position
 *  embedding over the concatenated [text; visual] sequence (e.g. CogVideoX,
 *  `use_rotary_positional_embeddings: false`): the visual patch positions are
 *  trained assuming the text run always occupies the full
 *  `manifest.textEncoder.maxTokens` slots, so a shorter, un-padded prompt
 *  would shift every visual position embedding out of alignment. See
 *  `encodeText` in `ort-runner.ts`, the single call site that supplies it. */
export interface HfTokenizer {
  encode(
    text: string,
    maxLength?: number,
  ): { inputIds: BigInt64Array; attentionMask: BigInt64Array };
}

export interface LoadedBundle {
  manifest: WebDiTManifest;
  dit: DitRunner;
  textEncoder: TextEncoderRunner;
  vae: VaeRunner;
  tokenizer: HfTokenizer;
  unload(): Promise<void>;
}

/**
 * Loads a bundle from an HTTP root URL. Dispatches on `manifest.backend`:
 *   - "ort"  : creates ORT-Web sessions for the .onnx graphs (browser path)
 *   - "mini" : reads quantized shards directly and runs pure-JS forward passes
 */
export async function loadBundle(bundleUrl: string): Promise<LoadedBundle> {
  const root = bundleUrl.endsWith("/") ? bundleUrl : bundleUrl + "/";
  const resolve = (p: string) => new URL(p, root).toString();
  const fetchBytes = async (p: string): Promise<Uint8Array> => {
    const res = await fetch(resolve(p));
    if (!res.ok) throw new Error(`bundle: failed to fetch ${p}: ${res.status} ${res.statusText}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const manifest = validateManifest(JSON.parse(await (await fetch(resolve("manifest.json"))).text()));

  if (manifest.backend === "mini") {
    return buildMiniBundle({
      manifest,
      readShard: fetchBytes,
      readTokenizer: () => loadMiniTokenizer(),
    });
  }
  return buildOrtBundle({
    manifest,
    resolveUrl: resolve,
    readTokenizer: () => loadHfTokenizer(resolve(manifest.files.tokenizer)),
  });
}

interface BundleLoadEnv {
  manifest: WebDiTManifest;
  readShard?: (relPath: string) => Promise<Uint8Array>;
  resolveUrl?: (relPath: string) => string;
  readTokenizer: () => Promise<HfTokenizer>;
}

async function buildOrtBundle(env: BundleLoadEnv): Promise<LoadedBundle> {
  const ort = await import("onnxruntime-web/webgpu");
  const { OrtDitRunner, OrtTextEncoderRunner, OrtVaeRunner } = await import("./runners-ort");
  const m = env.manifest;
  const url = env.resolveUrl!;
  const fetchExternalData = async (
    relPath: string | undefined,
  ): Promise<import("onnxruntime-web/webgpu").ExternalDataFileType[] | undefined> => {
    if (!relPath) return undefined;
    const res = await fetch(url(relPath));
    if (!res.ok) throw new Error(`bundle: failed to fetch external data ${relPath}: ${res.status}`);
    return [{ path: basename(relPath), data: new Uint8Array(await res.arrayBuffer()) }];
  };
  const [ditSession, teSession, vaeSession, tokenizer] = await Promise.all([
    (async () =>
      ort.InferenceSession.create(url(m.files.ditGraph), {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
        externalData: await fetchExternalData(m.files.ditGraphData),
      }))(),
    (async () =>
      ort.InferenceSession.create(url(m.files.textEncoderGraph), {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
        externalData: await fetchExternalData(m.files.textEncoderGraphData),
      }))(),
    (async () =>
      ort.InferenceSession.create(url(m.files.vaeGraph), {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
        externalData: await fetchExternalData(m.files.vaeGraphData),
      }))(),
    env.readTokenizer(),
  ]);
  const dit = new OrtDitRunner(ditSession);
  const textEncoder = new OrtTextEncoderRunner(teSession);
  const vae = new OrtVaeRunner(vaeSession);
  return {
    manifest: m,
    dit,
    textEncoder,
    vae,
    tokenizer,
    async unload() {
      await Promise.all([dit.release!(), textEncoder.release!(), vae.release!()]);
    },
  };
}

async function buildMiniBundle(env: BundleLoadEnv): Promise<LoadedBundle> {
  const { MiniDitRunner, MiniTextEncoderRunner, MiniVaeRunner } = await import("./runners-mini");
  const { ditWeights, teWeights, vaeWeights } = await readAllShards(env);
  return {
    manifest: env.manifest,
    dit: new MiniDitRunner(ditWeights),
    textEncoder: new MiniTextEncoderRunner(teWeights, env.manifest),
    vae: new MiniVaeRunner(vaeWeights, env.manifest),
    tokenizer: await env.readTokenizer(),
    async unload() {
      ditWeights.clear();
      teWeights.clear();
      vaeWeights.clear();
    },
  };
}

async function buildTorchBundle(env: BundleLoadEnv): Promise<LoadedBundle> {
  const { buildTorchRunners } = await import("./runners-torch");
  const { ditWeights, teWeights, vaeWeights } = await readAllShards(env);
  const parts = buildTorchRunners(env.manifest, ditWeights, teWeights, vaeWeights);
  return {
    manifest: env.manifest,
    dit: parts.dit,
    textEncoder: parts.textEncoder,
    vae: parts.vae,
    tokenizer: await env.readTokenizer(),
    async unload() {
      ditWeights.clear();
      teWeights.clear();
      vaeWeights.clear();
    },
  };
}

async function readAllShards(env: BundleLoadEnv): Promise<{
  ditWeights: Map<string, QuantizedTensor>;
  teWeights: Map<string, QuantizedTensor>;
  vaeWeights: Map<string, QuantizedTensor>;
}> {
  const { parseBundleShard } = await import("./shard-loader");
  const m = env.manifest;
  const read = env.readShard!;

  const ditWeights = new Map<string, QuantizedTensor>();
  for (const shard of m.files.ditWeightShards) {
    for (const [name, t] of parseBundleShard(await read(shard))) {
      ditWeights.set(name, t);
    }
  }
  const teWeights = parseBundleShard(await read(m.files.textEncoderWeights));
  const vaeWeights = parseBundleShard(await read(m.files.vaeWeights));
  return { ditWeights, teWeights, vaeWeights };
}

/**
 * Loads a bundle from an in-memory map of already-fetched buffers instead of
 * doing its own I/O. Used by studio (`studio/src/engine/webdit-engine.ts`),
 * which routes every bundle file through its own IndexedDB-backed read-through
 * weight cache (`getOrFetchWeight`) rather than letting webdit fetch raw URLs
 * itself — multi-hundred-MB DiT/VAE shards belong in the same canonical cache
 * as every other studio weight. Dispatches on `manifest.backend` exactly like
 * `loadBundle`/`loadBundleFromDir`; only the I/O source differs: every file
 * the manifest names is looked up in `files` by its bundle-relative path
 * (the same relative paths `manifest.files.*` declares) instead of being
 * fetched over HTTP or read from disk.
 *
 * `files` must contain every path `manifest.files` references (`ditGraph`,
 * each `ditWeightShards` entry, `textEncoderGraph`, `textEncoderWeights`,
 * `vaeGraph`, `vaeWeights`) plus, for the "ort" backend, the two well-known
 * tokenizer files inside the `manifest.files.tokenizer` directory
 * (`tokenizer.json` + `tokenizer_config.json` — see the file header comment).
 * The "mini"/"torch" backends don't read tokenizer files at all (they use the
 * built-in deterministic `loadMiniTokenizer`), so callers building a
 * mini-test/real-mini bundle for tests don't need to supply them.
 */
export async function loadBundleFromBuffers(
  manifest: WebDiTManifest,
  files: Record<string, ArrayBuffer>,
): Promise<LoadedBundle> {
  const readShard = async (rel: string): Promise<Uint8Array> => {
    const buf = files[rel];
    if (!buf) {
      throw new Error(`loadBundleFromBuffers: missing file '${rel}' in supplied buffers`);
    }
    return new Uint8Array(buf);
  };

  if (manifest.backend === "mini") {
    return buildMiniBundle({ manifest, readShard, readTokenizer: () => loadMiniTokenizer() });
  }
  if (manifest.backend === "torch") {
    return buildTorchBundle({ manifest, readShard, readTokenizer: () => loadMiniTokenizer() });
  }
  return buildOrtBundleFromBuffers(manifest, files, readShard);
}

async function buildOrtBundleFromBuffers(
  manifest: WebDiTManifest,
  files: Record<string, ArrayBuffer>,
  readShard: (rel: string) => Promise<Uint8Array>,
): Promise<LoadedBundle> {
  const ort = await import("onnxruntime-web/webgpu");
  const { OrtDitRunner, OrtTextEncoderRunner, OrtVaeRunner } = await import("./runners-ort");
  const m = manifest;
  const externalDataFor = async (
    relPath: string | undefined,
  ): Promise<import("onnxruntime-web/webgpu").ExternalDataFileType[] | undefined> => {
    if (!relPath) return undefined;
    return [{ path: basename(relPath), data: await readShard(relPath) }];
  };
  const [ditSession, teSession, vaeSession, tokenizer] = await Promise.all([
    (async () =>
      ort.InferenceSession.create(await readShard(m.files.ditGraph), {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
        externalData: await externalDataFor(m.files.ditGraphData),
      }))(),
    (async () =>
      ort.InferenceSession.create(await readShard(m.files.textEncoderGraph), {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
        externalData: await externalDataFor(m.files.textEncoderGraphData),
      }))(),
    (async () =>
      ort.InferenceSession.create(await readShard(m.files.vaeGraph), {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
        externalData: await externalDataFor(m.files.vaeGraphData),
      }))(),
    loadHfTokenizerFromBuffers(m.files.tokenizer, files),
  ]);
  const dit = new OrtDitRunner(ditSession);
  const textEncoder = new OrtTextEncoderRunner(teSession);
  const vae = new OrtVaeRunner(vaeSession);
  return {
    manifest: m,
    dit,
    textEncoder,
    vae,
    tokenizer,
    async unload() {
      await Promise.all([dit.release!(), textEncoder.release!(), vae.release!()]);
    },
  };
}

/**
 * Build an `HfTokenizer` directly from already-fetched tokenizer.json /
 * tokenizer_config.json buffers, bypassing `AutoTokenizer.from_pretrained`'s
 * own fetch (which needs a real fetchable directory URL — not available when
 * the caller only has in-memory buffers). `PreTrainedTokenizer`'s constructor
 * accepts the parsed JSON directly; `AutoTokenizer.from_pretrained` is just a
 * fetch + this same construction, so this is the fetch-free equivalent.
 */
async function loadHfTokenizerFromBuffers(
  tokenizerDir: string,
  files: Record<string, ArrayBuffer>,
): Promise<HfTokenizer> {
  const dir = tokenizerDir.endsWith("/") ? tokenizerDir : `${tokenizerDir}/`;
  const decoder = new TextDecoder();
  const readJson = (name: string): unknown => {
    const buf = files[`${dir}${name}`];
    if (!buf) {
      throw new Error(`loadBundleFromBuffers: missing tokenizer file '${dir}${name}'`);
    }
    return JSON.parse(decoder.decode(buf));
  };
  const { PreTrainedTokenizer } = await import("@huggingface/transformers");
  const tokenizerJSON = readJson("tokenizer.json");
  const tokenizerConfig = readJson("tokenizer_config.json");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tok = new (PreTrainedTokenizer as any)(tokenizerJSON, tokenizerConfig);
  return {
    encode(text: string, maxLength?: number) {
      const out = tok(text, tokenizerCallOptions(maxLength)) as Record<string, unknown>;
      return {
        inputIds: extractTokenIds(out.input_ids, "input_ids"),
        attentionMask: extractTokenIds(out.attention_mask, "attention_mask"),
      };
    },
  };
}

/** Shared by both HfTokenizer builders below — see the `HfTokenizer.encode`
 *  doc comment for why fixed-length padding matters. `undefined` (no
 *  `maxLength`) leaves the tokenizer's own default (no padding) behavior. */
function tokenizerCallOptions(
  maxLength: number | undefined,
): { padding?: "max_length"; max_length?: number; truncation?: boolean } {
  if (maxLength === undefined) return {};
  return { padding: "max_length", max_length: maxLength, truncation: true };
}

/**
 * Node-side bundle loader for integration tests. Reads files from a
 * directory instead of fetching over HTTP.
 */
export async function loadBundleFromDir(bundleDir: string): Promise<LoadedBundle> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const manifest = validateManifest(
    JSON.parse(await fs.readFile(path.join(bundleDir, "manifest.json"), "utf-8")),
  );
  const readShard = (rel: string) => fs.readFile(path.join(bundleDir, rel)).then((b) => new Uint8Array(b));

  if (manifest.backend === "mini") {
    return buildMiniBundle({ manifest, readShard, readTokenizer: () => loadMiniTokenizer() });
  }
  if (manifest.backend === "torch") {
    return buildTorchBundle({ manifest, readShard, readTokenizer: () => loadMiniTokenizer() });
  }
  return buildOrtBundle({
    manifest,
    resolveUrl: (rel) => "file://" + path.resolve(bundleDir, rel).replace(/\\/g, "/"),
    readTokenizer: () => loadHfTokenizer(path.join(bundleDir, manifest.files.tokenizer)),
  });
}

/**
 * Loads a HF tokenizer from a directory URL inside the bundle.
 */
export async function loadHfTokenizer(dirUrl: string): Promise<HfTokenizer> {
  const { AutoTokenizer, env } = await import("@huggingface/transformers");
  env.allowLocalModels = true;
  const url = dirUrl.endsWith("/") ? dirUrl : dirUrl + "/";
  const tok = await AutoTokenizer.from_pretrained(url);
  return {
    encode(text: string, maxLength?: number) {
      const out = tok(text, tokenizerCallOptions(maxLength)) as Record<string, unknown>;
      return {
        inputIds: extractTokenIds(out.input_ids, "input_ids"),
        attentionMask: extractTokenIds(out.attention_mask, "attention_mask"),
      };
    },
  };
}

/**
 * Trivial deterministic tokenizer used by the mini-test bundle. No network,
 * no @huggingface/transformers dep at runtime — just hashes characters into
 * a fixed-length token sequence. Sufficient for integration tests.
 */
async function loadMiniTokenizer(): Promise<HfTokenizer> {
  const DEFAULT_MAX = 8;
  return {
    encode(text: string, maxLength?: number) {
      const MAX = maxLength ?? DEFAULT_MAX;
      const ids = new BigInt64Array(MAX);
      const mask = new BigInt64Array(MAX);
      for (let i = 0; i < MAX; i++) {
        const ch = text.charCodeAt(i % Math.max(1, text.length)) || 0;
        ids[i] = BigInt(ch & 0x3f); // vocab=64 in mini-test
        mask[i] = i < text.length ? 1n : 0n;
      }
      return { inputIds: ids, attentionMask: mask };
    },
  };
}

function extractTokenIds(value: unknown, name: string): BigInt64Array {
  const candidate = (value as { data?: unknown } | null)?.data ?? value;
  if (candidate instanceof BigInt64Array) return candidate;
  if (
    candidate instanceof Int32Array ||
    candidate instanceof Int16Array ||
    candidate instanceof Uint32Array ||
    candidate instanceof Uint16Array ||
    Array.isArray(candidate)
  ) {
    const arr = candidate as ArrayLike<number>;
    const out = new BigInt64Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = BigInt(Math.trunc(arr[i]!));
    return out;
  }
  throw new Error(`Unsupported tokenizer output shape for ${name}`);
}

/** Re-exported for callers that want the legacy name. */
export const loadTokenizer = loadHfTokenizer;

/** Last path segment — deliberately not `node:path` (this module also runs
 *  in the browser). Used to turn a bundle-relative external-data path (e.g.
 *  "graph/dit.onnx.data") into the bare filename ORT-Web's `externalData`
 *  option matches against the `location` string embedded in the .onnx. */
function basename(relPath: string): string {
  const parts = relPath.split("/");
  return parts[parts.length - 1]!;
}
