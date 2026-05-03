import type { ArchitectureAdapter } from "./base";
import { buildManifestWith, defaultBundleFiles } from "./defaults";

/**
 * Tiny synthetic architecture used for integration tests. Bundle is small
 * enough to fit in memory and exercises the full pipeline (convert → bundle
 * → load → generate) with the Mini backend (pure-JS forward passes that
 * read weights directly from our shard format — no ONNX, no GPU).
 *
 * Shape: latent c=4, vae 2× spatial / 2× temporal, embedDim=8, vocab=64.
 * Weights this adapter expects in the bundle's DiT shard:
 *   "dit.scale" : f32[4]   per-channel scale
 *   "dit.bias"  : f32[4]   per-channel bias
 * Text encoder shard:
 *   "te.proj"   : f32[64, 8]   token-id -> embedding lookup
 * VAE shard:
 *   "vae.proj"  : f32[3, 4]    latent channels -> RGB
 */
export const miniTest: ArchitectureAdapter = {
  id: "mini-test",
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
        architecture: "mini-test",
        scheduler: "flow-match-rect",
        backend: "mini",
        latentShape: { c: 4, t: 1, h: 1, w: 1 },
        vaeCompression: { spatial: 2, temporal: 2 },
        patchSize: { d: 1, h: 1, w: 1 },
        textEncoder: { kind: "mini-hash", maxTokens: 8, embedDim: 8 },
        defaults: { steps: 2, guidanceScale: 1.0, frames: 4, height: 8, width: 8 },
        files: {
          ...defaultBundleFiles(),
          // Mini backend doesn't use ONNX graphs; placeholder paths so verify still finds something.
          ditGraph: "graph/dit.onnx",
          textEncoderGraph: "graph/text_encoder.onnx",
          vaeGraph: "graph/vae.onnx",
        },
      },
      q,
    ),
};
