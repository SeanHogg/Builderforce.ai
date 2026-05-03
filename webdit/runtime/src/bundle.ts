import * as ort from "onnxruntime-web/webgpu";
import type { WebDiTManifest } from "./types";

/** Minimal tokenizer surface the runtime depends on. Backed by @huggingface/transformers. */
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

async function loadTokenizer(_url: string): Promise<HfTokenizer> {
  // Wire up @huggingface/transformers AutoTokenizer in the next pass.
  throw new Error("loadTokenizer not yet implemented");
}
