import type { ArchitectureAdapter } from "./base";
import { buildManifestWith, diffusersSourceLayout } from "./defaults";

/**
 * CogVideoX-2b (Tsinghua / Zhipu, `THUDM/CogVideoX-2b`). The 2B variant is
 * the smallest of the DiT video families and the most realistic browser
 * candidate without distillation.
 *
 * Real weights verified against the upstream repo's own config.json files
 * (2026-08 conversion — see the R2 bundle upload notes):
 *   - transformer/config.json: 30 layers, 30 heads × 64 dim (hidden 1920),
 *     patch_size=2 (spatial only — no temporal patching),
 *     use_rotary_positional_embeddings=false (learned absolute position
 *     embeddings instead — see the text encoder note below),
 *     text_embed_dim=4096, in/out_channels=16.
 *   - text_encoder/config.json: `T5EncoderModel`, google/t5-v1_1-xxl
 *     (encoder-only half of T5-XXL, ~4.7B params, d_model=4096,
 *     max_text_seq_length=226 on the transformer side). NOT CLIP-L — the
 *     original placeholder below assumed a CLIP-L swap that would have
 *     needed fine-tuning; the real model's native T5-XXL encoder avoids
 *     that entirely, at the cost of a much bigger text encoder.
 *   - vae/config.json: `AutoencoderKLCogVideoX`, 8× spatial / 4× temporal
 *     compression, and — verified against the real decoder's actual output
 *     shape, not assumed — CAUSAL: 13 latent frames decode to 49 pixel
 *     frames, not the naive 13*4=52 (`vaeCompression.causal: true` below;
 *     see its doc comment in `@webdit/shared` for the formula and why
 *     getting this wrong throws on every real generation, not just
 *     miscounts).
 *   - scheduler/scheduler_config.json: `CogVideoXDDIMScheduler` —
 *     prediction_type=v_prediction, discrete 0..999 timesteps ("trailing"
 *     spacing), rescale_betas_zero_snr=true, snr_shift_scale=3.0. This is
 *     NOT the generic epsilon/continuous-sigma Euler sampler webdit ships
 *     for LTX/SD-family models — using that here would silently produce
 *     incoherent output (right shapes, wrong math). See
 *     `runtime/src/scheduler/ddim-vpred-zsnr.ts`, a faithful port of the
 *     real scheduler's math, added specifically for this architecture.
 *
 * `textEncoder.maxTokens=226` is load-bearing, not just a truncation limit:
 * `use_rotary_positional_embeddings=false` means the transformer adds a
 * learned absolute position embedding to the concatenated
 * [text_tokens; visual_patches] sequence, trained assuming the text run is
 * always exactly 226 slots (real prompts are padded with T5's own pad-token
 * encoder output, not truncated to their natural length) — a shorter
 * unpadded run would shift every visual position out of alignment. See the
 * `HfTokenizer.encode(text, maxLength)` doc comment in `bundle.ts`.
 */
export const cogvideox2b: ArchitectureAdapter = {
  id: "cogvideox-2b",
  expectedSourceLayout: diffusersSourceLayout,
  buildManifest: (q) =>
    buildManifestWith(
      {
        architecture: "cogvideox-2b",
        scheduler: "ddim-vpred-zsnr",
        latentShape: { c: 16, t: 1, h: 1, w: 1 },
        vaeCompression: { spatial: 8, temporal: 4, causal: true },
        patchSize: { d: 1, h: 2, w: 2 },
        textEncoder: { kind: "t5-xxl", maxTokens: 226, embedDim: 4096 },
        defaults: { steps: 50, guidanceScale: 6.0, frames: 49, height: 480, width: 720 },
      },
      q,
    ),
};
