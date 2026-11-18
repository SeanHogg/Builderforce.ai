import { createWebGPUBackend, requestEngineDevice, type WebGPUBackend } from "../../src/backend/webgpu";
import type { EngineDevice } from "../../src/backend/webgpu/device";

/**
 * Acquire a real WebGPU device through Dawn's Node binding (`webgpu` npm).
 * When there is no adapter (headless CI, no driver) the WebGPU suites SKIP
 * with the reason this returns — they never fail for want of a GPU.
 */
export interface GpuProbe {
  backend: WebGPUBackend | null;
  reason: string;
  /** A further, independent device on the same GPU (for tests that destroy one). */
  newDevice: () => Promise<EngineDevice>;
}

export async function probeGpu(): Promise<GpuProbe> {
  try {
    const { create } = (await import("webgpu")) as { create: (flags: string[]) => GPU };
    const gpu = create([]);
    const backend = await createWebGPUBackend({ gpu });
    return { backend, reason: `adapter: ${backend.adapterDescription}`, newDevice: () => requestEngineDevice({ gpu }) };
  } catch (error) {
    return {
      backend: null,
      reason: `no WebGPU adapter: ${error instanceof Error ? error.message : String(error)}`,
      newDevice: () => Promise.reject(new Error("no WebGPU adapter")),
    };
  }
}
