# webdit

WebDiT: in-browser diffusion-transformer text-to-video (CogVideoX-2b, Wan2.5,
Mochi-1, LTX2-distilled), running over `onnxruntime-web`/WebGPU via a custom
bundle format.

## Packages

- **`shared`** — the bundle manifest format (`WebDiTManifest`, `BundleFiles`),
  architecture/quantization/backend id unions, and the quantized-tensor shard
  format shared by `converter` (which writes bundles) and `runtime` (which
  loads them). Single source of truth so the two sides cannot drift.
- **`runtime`** — the browser-side loader + inference runtime: bundle loaders
  (`loadBundle` over HTTP, `loadBundleFromDir` for Node tests,
  `loadBundleFromBuffers` for a caller that already has the bytes),
  ORT-Web/WebGPU session wrappers, the backend-agnostic denoise loop
  (`runDenoiseLoop`), and the flow-match/Euler schedulers.
- **`converter`** — an offline CLI (`webdit-convert`) an operator runs to turn
  an already-exported HuggingFace `diffusers` checkpoint (ONNX graphs +
  safetensors weights, produced by an external Python step that is NOT part of
  this repo) into a deployable WebDiT bundle: `manifest.json` + sharded
  weights + tokenizer files, ready to upload to R2.
- **`torch`** — a small, from-scratch, inference-only tensor/NN library used
  only by `converter`'s and `runtime`'s synthetic `mini-test`/`real-mini` test
  architectures (pure-JS forward passes so integration tests exercise real
  bytes without needing a GPU or a real ONNX export). It is **not** used by
  any of the 4 real production video architectures — those run entirely
  through `onnxruntime-web`.

## Consumer

`shared` and `runtime` are consumed by [`studio`](../studio) as its WebDiT
diffusion-transformer generation backend — a second generation path alongside
studio's original LCM/SD-Turbo latent-diffusion engine, dispatched by model
descriptor (see `studio/src/engine/webdit-engine.ts` and
`studio/src/engine/video-engine.ts`). `converter` and `torch` are not runtime
dependencies of `studio` — `converter` is a build-time/operator tool, and
`torch` never ships to a browser bundle that only ever selects `"ort"`-backend
architectures.
