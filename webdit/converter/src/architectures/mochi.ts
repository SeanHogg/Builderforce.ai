import type { ArchitectureAdapter } from "./base";
import { buildManifestWith, diffusersSourceLayout } from "./defaults";

/**
 * Mochi-1 (Genmo). 10B AsymmDiT. Like Wan, the full model is too large for
 * browser execution; these defaults assume a distilled / quantized variant.
 *
 * Mochi-1 trains with rectified flow; its causal VAE compresses 8× spatial
 * and 6× temporal with a 12-channel latent.
 */
export const mochi1: ArchitectureAdapter = {
  id: "mochi-1",
  expectedSourceLayout: diffusersSourceLayout,
  buildManifest: (q) =>
    buildManifestWith(
      {
        architecture: "mochi-1",
        scheduler: "flow-match-rect",
        latentShape: { c: 12, t: 1, h: 1, w: 1 },
        vaeCompression: { spatial: 8, temporal: 6 },
        patchSize: { d: 1, h: 2, w: 2 },
        textEncoder: { kind: "clip-l", maxTokens: 77, embedDim: 768 },
        defaults: { steps: 64, guidanceScale: 4.5, frames: 163, height: 480, width: 848 },
      },
      q,
    ),
};
