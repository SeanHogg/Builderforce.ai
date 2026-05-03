import type { ArchitectureAdapter } from "./base";
import { buildManifestWith, diffusersSourceLayout } from "./defaults";

/**
 * LTX-Video 2 distilled (~2B DiT, rectified-flow, causal VAE).
 * The text encoder is swapped from T5-XXL to CLIP-L during upstream ONNX
 * export — T5-XXL is too large for a browser bundle.
 */
export const ltx2Distilled: ArchitectureAdapter = {
  id: "ltx2-distilled",
  expectedSourceLayout: diffusersSourceLayout,
  buildManifest: (q) =>
    buildManifestWith(
      {
        architecture: "ltx2-distilled",
        scheduler: "flow-match-rect",
        latentShape: { c: 128, t: 8, h: 32, w: 32 },
        vaeCompression: { spatial: 32, temporal: 8 },
        patchSize: { d: 1, h: 1, w: 1 },
        textEncoder: { kind: "clip-l", maxTokens: 77, embedDim: 768 },
        defaults: { steps: 8, guidanceScale: 1.0, frames: 121, height: 512, width: 768 },
      },
      q,
    ),
};
