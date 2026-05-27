/**
 * @seanhogg/builderforce-studio
 *
 * Public entry point. Exports the engine plus React components. Consumers that
 * want the engine without React should import from
 * `@seanhogg/builderforce-studio/engine`.
 */

export type {
  MambaStateSnapshot,
  DeviceTarget,
  ActiveDevice,
  DiffusionModelId,
  CoherenceMode,
  WeightSource,
  ModelDescriptor,
  VideoEngineOptions,
  GenerateOptions,
  GenerateResult,
} from './types';

export { VideoEngine } from './engine/video-engine';
export { probeDevice, hasWebGPUSupport } from './engine/device-router';
export { MODEL_REGISTRY } from './engine/diffusion-engine';
export { configureOnnxRuntime } from './engine/onnx-runtime-config';
export type { OnnxRuntimeConfigOptions } from './engine/onnx-runtime-config';

export { StudioPanel } from './components/StudioPanel';
export type { StudioPanelProps } from './components/StudioPanel';
export { ModelPicker } from './components/ModelPicker';
export { CoherenceControls } from './components/CoherenceControls';
export { VideoPreview } from './components/VideoPreview';
export { useEngineStatus } from './components/useEngineStatus';
export type { EngineStatus } from './components/useEngineStatus';
