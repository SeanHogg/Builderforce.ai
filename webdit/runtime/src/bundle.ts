import * as ort from "onnxruntime-web/webgpu";
import type { WebDiTManifest } from "./types";

/** Minimal tokenizer surface the runtime depends on. */
export interface HfTokenizer {
  encode(text: string): { inputIds: BigInt64Array; attentionMask: BigInt64Array };
}

export interface LoadedBundle {
  manifest: WebDiTManifest;
  dit: ort.InferenceSession;
  textEncoder: ort.InferenceSession;
  vae: ort.InferenceSession;
  tokenizer: HfTokenizer;
  unload(): Promise<void>;
}

const SESSION_OPTS: ort.InferenceSession.SessionOptions = {
  executionProviders: ["webgpu"],
  graphOptimizationLevel: "all",
};

export async function loadBundle(bundleUrl: string): Promise<LoadedBundle> {
  const root = bundleUrl.endsWith("/") ? bundleUrl : bundleUrl + "/";
  const resolve = (p: string) => new URL(p, root).toString();

  const manifest = (await (await fetch(resolve("manifest.json"))).json()) as WebDiTManifest;
  if (manifest.bundleVersion !== 1) {
    throw new Error(`Unsupported WebDiT bundle version: ${manifest.bundleVersion}`);
  }

  const [dit, textEncoder, vae, tokenizer] = await Promise.all([
    ort.InferenceSession.create(resolve(manifest.files.ditGraph), SESSION_OPTS),
    ort.InferenceSession.create(resolve(manifest.files.textEncoderGraph), SESSION_OPTS),
    ort.InferenceSession.create(resolve(manifest.files.vaeGraph), SESSION_OPTS),
    loadTokenizer(resolve(manifest.files.tokenizer)),
  ]);

  return {
    manifest,
    dit,
    textEncoder,
    vae,
    tokenizer,
    async unload() {
      await Promise.all([dit.release(), textEncoder.release(), vae.release()]);
    },
  };
}

/**
 * Loads a HF tokenizer from a directory URL inside the bundle. The directory
 * must contain tokenizer.json + tokenizer_config.json, matching what
 * `AutoTokenizer.save_pretrained()` writes.
 */
export async function loadTokenizer(dirUrl: string): Promise<HfTokenizer> {
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
