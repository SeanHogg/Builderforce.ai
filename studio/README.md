# @seanhogg/builderforce-studio

> Headless, fully client-side AI video-generation **engine** for the browser. Runs LCM / SD-Turbo diffusion on WebGPU or WebNN, conditioned on a Mamba SSM state for frame-to-frame temporal coherence, and muxes MP4 via WebCodecs. No React, no UI, no server GPU.

This package is the **engine**. For a ready-made React `<StudioPanel>` component, install [`@seanhogg/builderforce-studio-embedded`](https://www.npmjs.com/package/@seanhogg/builderforce-studio-embedded), which builds on this.

```bash
npm install @seanhogg/builderforce-studio \
  onnxruntime-web @huggingface/transformers @seanhogg/builderforce-sdk
```

## Usage

```ts
import { VideoEngine, probeDevice } from '@seanhogg/builderforce-studio';

const engine = await VideoEngine.create({
  authToken: 'bfk_...',          // or a tenant JWT — Authorization: Bearer
  model: 'lcm-dreamshaper-v7',   // | 'sd-turbo'
  device: 'auto',                // 'webnn' | 'webgpu' | 'cpu' | 'auto'
});

if (!engine) {
  // No viable device — render an unsupported state in your UI.
  return;
}

const result = await engine.generate({
  prompt: 'a fox running through autumn forest at golden hour',
  frames: 24,
  fps: 12,
  steps: 4,
  coherence: 'prompt-bias',       // | 'latent-residual'
  coherenceStrength: 0.5,
  onFrame: (idx, bitmap) => { /* live preview */ },
});

// result.blob       → MP4 Blob
// result.mambaState → updated MambaStateSnapshot (round-trips to IDB / R2)
// result.frames     → ImageBitmap[]
```

> `VideoEngineOptions.apiKey` is still accepted as an alias; new code should pass `authToken`.

## Architecture

```
[Short prompt]
   │  HTTPS — Builderforce LLM gateway (prompt expansion)
   ▼
[VideoEngine] ── per-frame loop ──┐
   ▼                              │  Mamba state h_t
[DiffusionEngine]                 │  feeds the next frame via
   ├─ CLIP tokenizer (transformers.js) │  prompt-bias OR latent-residual
   ├─ text-encoder / UNet / VAE (onnxruntime-web)
   └─ LCM consistency-model scheduler
   ▼                              │
[MambaCoherence] ─── advances h_t ┘
   ▼
[WebCodecsMuxer] → MP4 Blob
```

## Exports

`VideoEngine`, `probeDevice`, `hasWebGPUSupport`, `configureOnnxRuntime`, `MODEL_REGISTRY`, and all engine types (`MambaStateSnapshot`, `DiffusionModelId`, `GenerateOptions`, `GenerateResult`, `ProbedDevice`, …).

WASM binaries load from a CDN at runtime via `configureOnnxRuntime()` so nothing multi-MB ships in your bundle.

## Weight caching, residency and prefetch

These come from [`@seanhogg/builderforce-webcontainers/ml`](https://www.npmjs.com/package/@seanhogg/builderforce-webcontainers)
(only that subpath is imported — never the package root), wired in `src/engine/residency/`. It is a
build-time dev dependency: tsup bundles it into Studio's output, so consumers do not install it.

- **Weight caching** — `createModelCache` (`valueFormat: 'raw'`) over the same `builderforce-studio-weights`
  IndexedDB database Studio has always used. Values stay raw `ArrayBuffer`s, so weights cached by earlier
  versions keep loading without a re-download and older Studio builds still read new writes.
- **VRAM residency** — `createMemoryManager` budgets every ORT session (text encoder, UNet, VAE). The
  draft and refinement engines share one budget, so loading the refinement model evicts and releases
  the draft's sessions whenever both cannot fit.
- **Refinement-weight prefetch** — once the draft model is up, `createPrefetcher` warms the refinement
  model's weights into that IndexedDB store (holding no bytes in memory); the refinement pass waits for
  any in-flight warm, then reads the weights from the store instead of downloading again.

Studio runs no local text LLM, so the package's KV cache, knowledge memory, inference client, adaptive
controller and learner are not used.

## Model weights (R2 proxy) — operator workflow

At runtime the engine fetches each ONNX weight file from, in order:

1. `https://api.builderforce.ai/api/studio/weights/<model>/<file>` — the R2 proxy
   (`api/src/presentation/routes/studioWeightRoutes.ts`, R2 key
   `studio-weights/<model>/<file>` in the `builderforce-uploads` bucket).
2. the HuggingFace CDN — automatic fallback.

The engine works out of the box on the HF fallback, but every cold weight load
then pays 300–800 ms of HF latency and risks HF rate limits. Populate R2 once so
the proxy serves first-party, immutable, edge-cached weights:

```bash
# From the api worker directory (so the bucket binding resolves), with wrangler
# authenticated. Downloads the canonical files from HF and pushes them to R2:
node ../studio/scripts/upload-studio-weights.mjs --remote

# One model from an already-downloaded export dir (<dir>/<model>/<file>):
node ../studio/scripts/upload-studio-weights.mjs --model lcm-dreamshaper-v7 --from ./weights --remote

# See exactly what would run without touching anything:
node ../studio/scripts/upload-studio-weights.mjs --dry-run
```

The script's manifest mirrors `MODEL_REGISTRY` in
[`src/engine/diffusion-engine.ts`](src/engine/diffusion-engine.ts) — when you add
a model or change a weight path there, update
[`scripts/upload-studio-weights.mjs`](scripts/upload-studio-weights.mjs) too, or
the new model stays on the HF fallback. Run `--help` for all flags.

## License

MIT
