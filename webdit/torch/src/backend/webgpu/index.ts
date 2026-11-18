/**
 * `@webdit/torch/webgpu` — the WebGPU backend. Kept off the root entry so a
 * consumer that only runs the CPU path never needs the WebGPU type
 * declarations (`@webgpu/types`).
 */
export { WebGPUBackend, createWebGPUBackend } from "./webgpu-backend";
export {
  requestEngineDevice,
  WebGPUUnavailableError,
  type EngineDevice,
  type WebGPUDeviceOptions,
} from "./device";
export { BufferPool, VramBudgetError, type PoolStats } from "./buffer-pool";
export { GpuTensor } from "./gpu-tensor";
