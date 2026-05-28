# @seanhogg/builderforce-studio-embedded

> The full embeddable AI Video Studio for React. Drop `<StudioPanel>` into any app for client-side video generation — LCM / SD-Turbo diffusion on WebGPU/WebNN, Mamba SSM temporal coherence, WebCodecs MP4 output. No server GPU, no frame upload.

This is the **React layer** on top of the headless [`@seanhogg/builderforce-studio`](https://www.npmjs.com/package/@seanhogg/builderforce-studio) engine. If you only need the engine (custom UI, non-React, or headless workflows), install that package directly instead.

```bash
npm install @seanhogg/builderforce-studio-embedded \
  @seanhogg/builderforce-studio \
  onnxruntime-web @huggingface/transformers \
  react react-dom
```

## Usage

```tsx
import { StudioPanel } from '@seanhogg/builderforce-studio-embedded';
import '@seanhogg/builderforce-studio-embedded/styles.css';

export function App() {
  return (
    <StudioPanel
      authToken={process.env.BUILDERFORCE_TOKEN!}  // bfk_* API key or tenant JWT
      defaultModel="lcm-dreamshaper-v7"
      onVideoGenerated={(blob, mambaState) => {
        const url = URL.createObjectURL(blob);
        // …play, upload, or persist
      }}
    />
  );
}
```

`StudioPanel` self-gates: it probes WebGPU → WebNN → CPU and renders an unsupported state when no path is viable. Consumers never compute `hasWebGPU` — the panel owns that decision.

### Embedding inside a host that already has chrome

```tsx
<StudioPanel
  authToken={token}
  hideHeader            // suppress the panel's own title bar
  promptValue={prompt}  // host-supplied prompt (e.g. from a chat assistant)
  onPromptChange={setPrompt}
/>
```

This is exactly how the Builderforce.ai IDE mounts the studio as its **Video modality** — the IDE supplies the project chrome, the Brain hands over prompts, and the panel renders just the generation surface.

## Exports

Everything from the engine package is re-exported here, plus the React surface:

| Export | Kind |
|---|---|
| `StudioPanel`, `ModelPicker`, `CoherenceControls`, `VideoPreview` | React components |
| `useEngineStatus` | React hook |
| `VideoEngine`, `probeDevice`, `hasWebGPUSupport`, `configureOnnxRuntime`, `MODEL_REGISTRY` | engine (re-export) |

## License

MIT
