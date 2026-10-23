/**
 * What this page's WebGPU adapter offers, read WITHOUT creating a device — the support
 * record `localModelFit` checks a catalog model against. The WebLLM engine and the model
 * store's picker rows read it; `bfi` answers the same record itself
 * (`BfiEngine.support()`). Structurally typed: the DOM lib does not carry WebGPU yet.
 */

import type { LocalDeviceSupport } from '@builderforce/local-inference';
import { reportPageEngineFailure } from './engineFailure';
import { SettleTimeoutError, withTimeout } from './settleWithin';

/**
 * The longest an adapter request may take. `requestAdapter()` can hang without ever
 * settling (a wedged GPU process, a driver reset); unbounded, every turn that asked
 * "is there WebGPU?" never settled with it. Past this it reads as no WebGPU.
 */
export const WEBGPU_ADAPTER_TIMEOUT_MS = 5_000;

interface GpuAdapterLike {
  features?: { has(name: string): boolean };
  limits?: { maxStorageBufferBindingSize?: number; maxBufferSize?: number };
}

interface GpuLike {
  requestAdapter(options?: { powerPreference?: 'high-performance' | 'low-power' }): Promise<GpuAdapterLike | null>;
}

const UNSUPPORTED = (reason: string): LocalDeviceSupport => ({
  contractVersion: 2,
  supported: false,
  reason,
  f16: false,
  maxBufferBytes: 0,
  maxBufferSizeBytes: 0,
  maxStorageBufferBindingSizeBytes: 0,
  requestedPowerPreference: 'high-performance',
});

/** This page's WebGPU entry point, read at call time (SSR safe: none on a server). */
const pageGpu = (): GpuLike | undefined => (globalThis as { navigator?: { gpu?: GpuLike } }).navigator?.gpu;

/**
 * Whether this browser exposes WebGPU at all — synchronous, requests no adapter, so it is
 * safe during render. The ONE feature check for every on-device surface in a host (the
 * semantic cache's embedder, voice, training badges); what the adapter can actually do is
 * {@link webGpuSupport}'s question.
 */
export function hasWebGPU(): boolean {
  return pageGpu() != null;
}

/** The adapter's support record. Never throws, never hangs: no WebGPU — or an adapter
 *  request that did not settle within {@link WEBGPU_ADAPTER_TIMEOUT_MS} — reads as
 *  unsupported, with the reason recorded. */
export async function webGpuSupport(
  gpu: GpuLike | undefined = pageGpu(),
  timeoutMs: number = WEBGPU_ADAPTER_TIMEOUT_MS,
): Promise<LocalDeviceSupport> {
  if (!gpu) return UNSUPPORTED('webgpu_missing');
  let adapter: GpuAdapterLike | null;
  try {
    adapter = await withTimeout(gpu.requestAdapter({ powerPreference: 'high-performance' }), timeoutMs, 'WebGPU requestAdapter');
  } catch (e) {
    reportPageEngineFailure('webllm', 'support', e);
    return UNSUPPORTED(e instanceof SettleTimeoutError ? 'adapter_timeout' : e instanceof Error ? e.message : String(e));
  }
  try {
    if (!adapter) return UNSUPPORTED('no_adapter');
    const maxBufferSizeBytes = adapter.limits?.maxBufferSize ?? 0;
    const maxStorageBufferBindingSizeBytes = adapter.limits?.maxStorageBufferBindingSize ?? 0;
    return {
      contractVersion: 2,
      supported: true,
      f16: adapter.features?.has('shader-f16') ?? false,
      maxBufferBytes: maxBufferSizeBytes,
      maxBufferSizeBytes,
      maxStorageBufferBindingSizeBytes,
      requestedPowerPreference: 'high-performance',
    };
  } catch (e) {
    return UNSUPPORTED(e instanceof Error ? e.message : String(e));
  }
}
