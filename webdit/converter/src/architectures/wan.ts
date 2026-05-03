import type { ArchitectureAdapter } from "./base";
import { buildManifestWith, diffusersSourceLayout } from "./defaults";

/**
 * Wan 2.5 (Alibaba). Full model is ~14B; usable in-browser only via a heavily
 * distilled / pruned variant — these defaults assume that exists upstream.
 *
 * Latent / compression numbers should be confirmed against the actual ONNX
 * export shipped by the model maintainer; values here track the published
 * Wan-VAE configuration (16-channel latent, 8× spatial / 4× temporal compression).
 */
export const wan25: ArchitectureAdapter = {
  id: "wan2.5",
  expectedSourceLayout: diffusersSourceLayout,
  buildManifest: (q) =>
    buildManifestWith(
      {
        architecture: "wan2.5",
        scheduler: "flow-match-rect",
        latentShape: { c: 16, t: 1, h: 1, w: 1 },
        vaeCompression: { spatial: 8, temporal: 4 },
        patchSize: { d: 1, h: 2, w: 2 },
        textEncoder: { kind: "clip-l", maxTokens: 77, embedDim: 768 },
        defaults: { steps: 20, guidanceScale: 5.0, frames: 81, height: 480, width: 832 },
      },
      q,
    ),
};
