import type { WebDiTManifest, WebDiTQuantization } from "@webdit/shared";
import type { ArchitectureAdapter, SourceLayout } from "./base";

/**
 * LTX-Video 2 distilled (~2B DiT, rectified-flow, causal VAE).
 * The text encoder is swapped from the original T5-XXL to CLIP-L upstream
 * during ONNX export — too big to ship in a browser bundle.
 */
export const ltx2Distilled: ArchitectureAdapter = {
  id: "ltx2-distilled",

  expectedSourceLayout(): SourceLayout {
    return {
      ditWeights: "transformer/diffusion_pytorch_model.safetensors",
      textEncoderWeights: "text_encoder/model.safetensors",
      vaeWeights: "vae/diffusion_pytorch_model.safetensors",
      ditGraph: "transformer/model.onnx",
      textEncoderGraph: "text_encoder/model.onnx",
      vaeGraph: "vae/decoder.onnx",
      tokenizerDir: "tokenizer",
    };
  },

  buildManifest(quantization: WebDiTQuantization): WebDiTManifest {
    return {
      bundleVersion: 1,
      architecture: "ltx2-distilled",
      quantization,
      scheduler: "flow-match-rect",
      latentShape: { c: 128, t: 8, h: 32, w: 32 },
      vaeCompression: { spatial: 32, temporal: 8 },
      patchSize: { d: 1, h: 1, w: 1 },
      textEncoder: { kind: "clip-l", maxTokens: 77, embedDim: 768 },
      defaults: { steps: 8, guidanceScale: 1.0, frames: 121, height: 512, width: 768 },
      files: {
        ditGraph: "graph/dit.onnx",
        ditWeightShards: [],
        textEncoderGraph: "graph/text_encoder.onnx",
        textEncoderWeights: "weights/text_encoder.bin",
        vaeGraph: "graph/vae.onnx",
        vaeWeights: "weights/vae.bin",
        tokenizer: "tokenizer/",
      },
    };
  },
};
