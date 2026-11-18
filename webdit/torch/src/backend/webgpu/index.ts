/**
 * `@webdit/torch/webgpu` — the WebGPU backend. Kept off the root entry so a
 * consumer that only runs the CPU path never needs the WebGPU type
 * declarations (`@webgpu/types`).
 */
export { WebGPUBackend, createWebGPUBackend, type WebGPUBackendOptions } from "./webgpu-backend";
export { DeviceLostError, GpuOperationError } from "./device-health";
export {
  requestEngineDevice,
  WebGPUUnavailableError,
  type EngineDevice,
  type WebGPUDeviceOptions,
} from "./device";
export { BufferPool, VramBudgetError, DEFAULT_MAX_POOLED_BYTES, type PoolStats } from "./buffer-pool";
export { GpuTensor, type GpuDType } from "./gpu-tensor";
