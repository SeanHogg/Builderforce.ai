/**
 * @seanhogg/builderforce-studio-embedded
 *
 * The full embeddable AI Video Studio — React components on top of the headless
 * @seanhogg/builderforce-studio engine. Drop <StudioPanel> into any React app to
 * get client-side video generation (WebGPU/WebNN diffusion + Mamba coherence +
 * WebCodecs MP4) with zero server GPU.
 *
 * Engine-only consumers (no React) should import from @seanhogg/builderforce-studio.
 */

// React component surface
export { StudioPanel } from './components/StudioPanel';
export type {
  StudioPanelProps,
  VideoVersionEntry,
  VideoVersionParams,
} from './components/StudioPanel';
export { ModelPicker } from './components/ModelPicker';
export { CoherenceControls } from './components/CoherenceControls';
export { VideoPreview } from './components/VideoPreview';
export { ProgressFeedback } from './components/ProgressFeedback';
export { useEngineStatus } from './components/useEngineStatus';
export type { EngineStatus } from './components/useEngineStatus';

// Convenience re-exports of the engine so consumers need only one import.
export {
  VideoEngine,
  probeDevice,
  hasWebGPUSupport,
  configureOnnxRuntime,
  MODEL_REGISTRY,
} from '@seanhogg/builderforce-studio';
export type {
  MambaStateSnapshot,
  DeviceTarget,
  ActiveDevice,
  ProbedDevice,
  DiffusionModelId,
  CoherenceMode,
  WeightSource,
  ModelDescriptor,
  OnnxFile,
  VideoEngineOptions,
  GenerateOptions,
  GenerateResult,
  OnnxRuntimeConfigOptions,
} from '@seanhogg/builderforce-studio';
