/**
 * @seanhogg/builderforce-studio — headless engine.
 *
 * Client-side video-generation engine: LCM / SD-Turbo diffusion on WebGPU or
 * WebNN (via onnxruntime-web), CLIP tokenization (via @huggingface/transformers),
 * Mamba SSM temporal coherence, and WebCodecs MP4 muxing. No React, no UI.
 *
 * For a ready-made React `<StudioPanel>`, install
 * @seanhogg/builderforce-studio-embedded, which builds on this engine.
 */

export type {
  MambaStateSnapshot,
  DeviceTarget,
  ActiveDevice,
  DiffusionModelId,
  CoherenceMode,
  QualityMode,
  WeightSource,
  ModelDescriptor,
  OnnxFile,
  OrtInputSpec,
  OrtTensorDtype,
  VideoEngineOptions,
  GenerateOptions,
  GenerateResult,
} from './types';

export { VideoEngine } from './engine/video-engine';
export { probeDevice, hasWebGPUSupport } from './engine/device-router';
export type { ProbedDevice } from './engine/device-router';
export { MODEL_REGISTRY } from './engine/diffusion-engine';
export { configureOnnxRuntime } from './engine/onnx-runtime-config';
export type { OnnxRuntimeConfigOptions } from './engine/onnx-runtime-config';
