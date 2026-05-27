# @seanhogg/builderforce-studio

> Embeddable client-side AI video studio. Runs Stable Diffusion (LCM / SD-Turbo) on WebGPU or WebNN inside any browser, conditioned on a Mamba SSM state vector for frame-to-frame temporal coherence, and muxes the result to MP4 via WebCodecs. No server-side GPU. No frame upload. Prompt expansion uses the Builderforce LLM gateway.

```bash
npm install @seanhogg/builderforce-studio \
  @seanhogg/builderforce-sdk \
  mambacode.js \
  onnxruntime-web
```

## Embedded usage

```tsx
import { StudioPanel } from '@seanhogg/builderforce-studio';
import '@seanhogg/builderforce-studio/styles.css';

export function MyApp() {
  return (
    <StudioPanel
      apiKey={process.env.BUILDERFORCE_API_KEY!}
      defaultModel="lcm-dreamshaper-v7"
      onVideoGenerated={(blob, state) => {
        const url = URL.createObjectURL(blob);
        // …upload, save, or play
      }}
    />
  );
}
```

`StudioPanel` self-gates: if the tenant isn't entitled to the `studio` module or no WebGPU/WebNN device is reachable, it renders an appropriate fallback. Consumers never compute `canUseStudio` or `hasWebGPU` — the panel owns those decisions.

## Engine-only usage

If you want full control over the pipeline (no React):

```ts
import { VideoEngine } from '@seanhogg/builderforce-studio/engine';

const engine = await VideoEngine.create({
  apiKey: 'bfk_...',
  model: 'lcm-dreamshaper-v7',
  device: 'auto',           // 'webnn' | 'webgpu' | 'cpu' | 'auto'
});

if (!engine) {
  // No path viable on this device — render fallback UI
  return;
}

const result = await engine.generate({
  prompt: 'a fox running through autumn forest at golden hour',
  frames: 24,
  fps: 12,
  steps: 4,
  coherence: 'prompt-bias',           // | 'latent-residual'
  coherenceStrength: 0.5,
  onFrame: (idx, bitmap) => { /* progress preview */ },
});

// result.blob       → MP4 Blob
// result.mambaState → updated MambaStateSnapshot (round-trips to IDB / R2)
// result.frames     → ImageBitmap[]
```

## Architecture

```
[Short prompt]
   │
   ▼  HTTPS  (Builderforce LLM gateway — existing /api/ai/chat endpoint)
[Detailed prompt + scene description]
   │
   ▼
[VideoEngine] ─── per-frame loop ───┐
   │                                 │
   ▼                                 │
[DiffusionEngine]                    │
   ├─ LCM 4-step / SD-Turbo 1-step   │  Mamba state h_t
   ├─ ONNX-RT-Web on WebGPU/WebNN    │  feeds back into next frame
   └─ shared denoise() primitive     │  via prompt-bias OR latent-residual
   │                                 │
   ▼                                 │
[MambaCoherence] ────── advances h_t ┘
   │
   ▼
[WebCodecsMuxer]
   │
   ▼
[MP4 Blob]
```

## License

MIT
