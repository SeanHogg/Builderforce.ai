import type { ArchitectureAdapter } from "./base";
import { buildManifestWith, defaultBundleFiles } from "./defaults";

/**
 * Real-mini: a small but structurally-correct DiT. Hidden=32, 2 transformer
 * blocks, 4 heads, latent c=4. ~few-hundred-K params; runs on CPU through
 * @webdit/torch. Used to prove the full pipeline works end-to-end on a
 * real architecture (RoPE, multi-head attention, transformer blocks,
 * timestep + text conditioning) without needing GPU acceleration or a
 * billion-parameter model checkpoint.
 *
 * Backend: "torch" — runs via @webdit/torch CPU forward pass, no ONNX.
 */
export const realMini: ArchitectureAdapter = {
  id: "real-mini",
  expectedSourceLayout: () => ({
    ditWeights: "transformer/diffusion_pytorch_model.safetensors",
    textEncoderWeights: "text_encoder/model.safetensors",
    vaeWeights: "vae/diffusion_pytorch_model.safetensors",
    ditGraph: "transformer/model.onnx",
    textEncoderGraph: "text_encoder/model.onnx",
    vaeGraph: "vae/decoder.onnx",
    tokenizerDir: "tokenizer",
  }),
  buildManifest: (q) =>
    buildManifestWith(
      {
        architecture: "real-mini",
        scheduler: "flow-match-rect",
        backend: "torch",
        latentShape: { c: 4, t: 1, h: 1, w: 1 },
        vaeCompression: { spatial: 1, temporal: 1 },
        patchSize: { d: 1, h: 1, w: 1 },
        textEncoder: { kind: "mini-hash", maxTokens: 8, embedDim: 8 },
        defaults: { steps: 2, guidanceScale: 1.0, frames: 2, height: 4, width: 4 },
        files: {
          ...defaultBundleFiles(),
          ditGraph: "graph/dit.onnx",
          textEncoderGraph: "graph/text_encoder.onnx",
          vaeGraph: "graph/vae.onnx",
        },
      },
      q,
    ),
};
