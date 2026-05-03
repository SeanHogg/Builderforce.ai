import { validateManifest, type QuantizedTensor, type WebDiTManifest } from "@webdit/shared";
import type { DitRunner, TextEncoderRunner, VaeRunner } from "./runners";

/** Minimal tokenizer surface the runtime depends on. */
export interface HfTokenizer {
  encode(text: string): { inputIds: BigInt64Array; attentionMask: BigInt64Array };
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
  const sessionOpts: import("onnxruntime-web/webgpu").InferenceSession.SessionOptions = {
    executionProviders: ["webgpu"],
    graphOptimizationLevel: "all",
  };
  const m = env.manifest;
  const url = env.resolveUrl!;
  const [ditSession, teSession, vaeSession, tokenizer] = await Promise.all([
    ort.InferenceSession.create(url(m.files.ditGraph), sessionOpts),
    ort.InferenceSession.create(url(m.files.textEncoderGraph), sessionOpts),
    ort.InferenceSession.create(url(m.files.vaeGraph), sessionOpts),
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
  const { parseBundleShard } = await import("./shard-loader");
  const { MiniDitRunner, MiniTextEncoderRunner, MiniVaeRunner } = await import("./runners-mini");
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

  return {
    manifest: m,
    dit: new MiniDitRunner(ditWeights),
    textEncoder: new MiniTextEncoderRunner(teWeights, m),
    vae: new MiniVaeRunner(vaeWeights, m),
    tokenizer: await env.readTokenizer(),
    async unload() {
      ditWeights.clear();
      teWeights.clear();
      vaeWeights.clear();
    },
  };
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
    return buildMiniBundle({
      manifest,
      readShard,
      readTokenizer: () => loadMiniTokenizer(),
    });
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
    encode(text: string) {
      const out = tok(text) as Record<string, unknown>;
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
  const MAX = 8;
  return {
    encode(text: string) {
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
