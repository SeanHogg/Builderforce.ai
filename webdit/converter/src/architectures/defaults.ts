import type { Backend, BundleFiles, WebDiTArchitecture, WebDiTManifest, WebDiTQuantization } from "@webdit/shared";
import type { SourceLayout } from "./base";

/**
 * HuggingFace `diffusers` source layout convention. Wan / Mochi / CogVideoX
 * all ship in this shape, so each adapter starts from this and overrides only
 * what's actually different. Single source of truth — change here once, every
 * adapter inherits.
 */
export function diffusersSourceLayout(): SourceLayout {
  return {
    ditWeights: "transformer/diffusion_pytorch_model.safetensors",
    textEncoderWeights: "text_encoder/model.safetensors",
    vaeWeights: "vae/diffusion_pytorch_model.safetensors",
    ditGraph: "transformer/model.onnx",
    textEncoderGraph: "text_encoder/model.onnx",
    vaeGraph: "vae/decoder.onnx",
    tokenizerDir: "tokenizer",
  };
}

/**
 * Default WebDiT bundle output paths. Bundle writer rewrites
 * `ditWeightShards` based on actual shard count; everything else is fixed.
 */
export function defaultBundleFiles(): BundleFiles {
  return {
    ditGraph: "graph/dit.onnx",
    ditWeightShards: [],
    textEncoderGraph: "graph/text_encoder.onnx",
    textEncoderWeights: "weights/text_encoder.bin",
    vaeGraph: "graph/vae.onnx",
    vaeWeights: "weights/vae.bin",
    tokenizer: "tokenizer/",
  };
}

export interface ArchitectureSpec {
  architecture: WebDiTArchitecture;
  scheduler: WebDiTManifest["scheduler"];
  backend?: Backend;
  latentShape: WebDiTManifest["latentShape"];
  vaeCompression: WebDiTManifest["vaeCompression"];
  patchSize: WebDiTManifest["patchSize"];
  textEncoder: WebDiTManifest["textEncoder"];
  defaults: WebDiTManifest["defaults"];
  files?: Partial<BundleFiles>;
}

export function buildManifestWith(
  spec: ArchitectureSpec,
  quantization: WebDiTQuantization,
): WebDiTManifest {
  return {
    bundleVersion: 1,
    architecture: spec.architecture,
    quantization,
    scheduler: spec.scheduler,
    backend: spec.backend ?? "ort",
    latentShape: spec.latentShape,
    vaeCompression: spec.vaeCompression,
    patchSize: spec.patchSize,
    textEncoder: spec.textEncoder,
    defaults: spec.defaults,
    files: { ...defaultBundleFiles(), ...spec.files },
  };
}
