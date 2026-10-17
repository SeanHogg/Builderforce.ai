/**
 * What this page's WebGPU adapter offers, read WITHOUT creating a device — the support
 * record `localModelFit` checks a catalog model against. The WebLLM engine and the model
 * store's picker rows read it; `bfi` answers the same record itself
 * (`BfiEngine.support()`). Structurally typed: the DOM lib does not carry WebGPU yet.
 */

import type { LocalDeviceSupport } from '@builderforce/local-inference';

interface GpuAdapterLike {
  features: { has(name: string): boolean };
  limits: { maxStorageBufferBindingSize?: number; maxBufferSize?: number };
}

interface GpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
}

const UNSUPPORTED = (reason: string): LocalDeviceSupport => ({ supported: false, reason, f16: false, maxBufferBytes: 0 });

/** The adapter's support record. Never throws: no WebGPU reads as unsupported. */
export async function webGpuSupport(
  gpu: GpuLike | undefined = (globalThis as { navigator?: { gpu?: GpuLike } }).navigator?.gpu,
): Promise<LocalDeviceSupport> {
  if (!gpu) return UNSUPPORTED('webgpu_missing');
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return UNSUPPORTED('no_adapter');
    return {
      supported: true,
      f16: adapter.features.has('shader-f16'),
      maxBufferBytes: adapter.limits.maxStorageBufferBindingSize ?? 0,
    };
  } catch (e) {
    return UNSUPPORTED(e instanceof Error ? e.message : String(e));
  }
}
