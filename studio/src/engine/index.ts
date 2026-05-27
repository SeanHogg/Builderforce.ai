/**
 * Engine-only entry point — exposes the runtime without pulling React.
 *
 * Consumers building custom UIs (Vue, Svelte, vanilla JS, headless workflows)
 * should import from this entry point.
 */

export { VideoEngine } from './video-engine';
export { probeDevice, hasWebGPUSupport } from './device-router';
export { MODEL_REGISTRY } from './diffusion-engine';
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
} from '../types';
