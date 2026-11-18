/**
 * WebGPU device acquisition for the engine. It reads `navigator.gpu` from
 * `globalThis`, which is the same object in a window and in a dedicated
 * Worker, and touches no DOM API — so the engine runs in a Worker. A host
 * without a global GPU (Node + Dawn in tests) passes its `GPU` in.
 *
 * Usage flags are spelled as numbers: the `GPUBufferUsage` / `GPUMapMode`
 * globals are not installed by every host (Dawn under Node does not).
 */

export const BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  STORAGE: 0x0080,
} as const;

export const MAP_MODE_READ = 0x0001;

export interface WebGPUDeviceOptions {
  /** The GPU entry point; defaults to `globalThis.navigator.gpu`. */
  gpu?: GPU;
  powerPreference?: GPUPowerPreference;
  /** Request `shader-f16` when the adapter offers it (default true). */
  preferF16?: boolean;
}

export interface EngineDevice {
  device: GPUDevice;
  /** True when the device was created with `shader-f16`. */
  f16: boolean;
  adapterDescription: string;
}

export class WebGPUUnavailableError extends Error {
  constructor(reason: string) {
    super(`WebGPU unavailable: ${reason}`);
    this.name = "WebGPUUnavailableError";
  }
}

function globalGpu(): GPU | undefined {
  const nav = (globalThis as { navigator?: { gpu?: GPU } }).navigator;
  return nav?.gpu;
}

export async function requestEngineDevice(options: WebGPUDeviceOptions = {}): Promise<EngineDevice> {
  const gpu = options.gpu ?? globalGpu();
  if (!gpu) throw new WebGPUUnavailableError("no navigator.gpu in this context");
  const adapter = await gpu.requestAdapter({ powerPreference: options.powerPreference ?? "high-performance" });
  if (!adapter) throw new WebGPUUnavailableError("requestAdapter() returned null");
  const f16 = (options.preferF16 ?? true) && adapter.features.has("shader-f16");
  const limits = adapter.limits;
  const device = await adapter.requestDevice({
    requiredFeatures: f16 ? ["shader-f16"] : [],
    requiredLimits: {
      maxStorageBuffersPerShaderStage: Math.min(8, limits.maxStorageBuffersPerShaderStage),
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
    },
  });
  const info = (adapter as { info?: { description?: string; vendor?: string } }).info;
  return { device, f16, adapterDescription: info?.description || info?.vendor || "unknown adapter" };
}
