import type { ArchitectureAdapter } from "./base";
import { buildManifestWith, diffusersSourceLayout } from "./defaults";

/**
 * CogVideoX-2b (Tsinghua / Zhipu). The 2B variant is the smallest of the DiT
 * video families and the most realistic browser candidate without distillation.
 *
 * Trained with DDIM-style epsilon prediction (use the Euler scheduler).
 * Latent: 16 channels, 8× spatial / 4× temporal compression.
 */
export const cogvideox2b: ArchitectureAdapter = {
  id: "cogvideox-2b",
  expectedSourceLayout: diffusersSourceLayout,
  buildManifest: (q) =>
    buildManifestWith(
      {
        architecture: "cogvideox-2b",
        scheduler: "euler",
        latentShape: { c: 16, t: 1, h: 1, w: 1 },
        vaeCompression: { spatial: 8, temporal: 4 },
        patchSize: { d: 1, h: 2, w: 2 },
        textEncoder: { kind: "clip-l", maxTokens: 77, embedDim: 768 },
        defaults: { steps: 50, guidanceScale: 6.0, frames: 49, height: 480, width: 720 },
      },
      q,
    ),
};
