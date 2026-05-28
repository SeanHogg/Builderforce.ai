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

## License

MIT
