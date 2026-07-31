/**
 * Device router — the canonical place to ask "can this browser run the studio?"
 *
 * Probes WebNN → WebGPU → CPU and returns the first path that initialises with
 * an actual usable device. The studio's React panel and engine both call this;
 * consumers never compute `hasWebGPU` themselves (DRY: shared decision lives
 * here, not in prop-drilled booleans).
 *
 * Returning `null` from `probeDevice` is the package's signal that the host
 * environment cannot run the studio at all — the StudioPanel renders an
 * unsupported state and the engine refuses to construct.
 */

import type { ActiveDevice, DeviceTarget } from '../types';

export interface ProbedDevice {
  kind: ActiveDevice;
  /** Present when kind === 'webgpu'. Owned by the studio engine after probe. */
  gpuDevice?: GPUDevice;
  /** Present when kind === 'webnn'. Same lifetime ownership. */
  mlContext?: unknown;
  /** Human-readable label for telemetry / UI ("NVIDIA GeForce RTX 4090", "Snapdragon X NPU", etc.). */
  label: string;
  /** Best-effort VRAM / unified-memory headroom in MB, or null when not exposed. */
  approxMemoryMb: number | null;
}

interface GpuWithRequestAdapter {
  gpu?: {
    requestAdapter(
      options?: { powerPreference?: 'low-power' | 'high-performance' }
    ): Promise<GPUAdapter | null>;
  };
}

interface MlContextOptions {
  deviceType?: 'cpu' | 'gpu' | 'npu';
  powerPreference?: 'default' | 'high-performance' | 'low-power';
}

interface NavigatorWithMl {
  ml?: {
    createContext(options?: MlContextOptions): Promise<unknown>;
  };
}

/**
 * Synchronous WebGPU-availability check. Returns true when the browser exposes
 * `navigator.gpu` — does NOT request an adapter, so it's safe to call during
 * render. Consumers that need the actual device should `await probeDevice('webgpu')`.
 */
export function hasWebGPUSupport(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/** Options for {@link probeDevice}. */
export interface ProbeOptions {
  /**
   * Called when an acquired WebGPU device is lost (driver reset, tab suspension,
   * GPU crash). The single hook for context-loss recovery: a consumer typically
   * re-runs `probeDevice` and rebuilds its pipelines. Not fired on an explicit
   * `device.destroy()` (reason === 'destroyed').
   */
  onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

/**
 * Probe in priority order. Pass an explicit `target` to force one path
 * (useful for tests and for the StudioPanel's "force CPU" advanced toggle).
 *
 * Returns null when nothing is reachable. The package's downstream code
 * checks this and renders / throws an unsupported state.
 */
export async function probeDevice(
  target: DeviceTarget = 'auto',
  opts: ProbeOptions = {},
): Promise<ProbedDevice | null> {
  const order: ActiveDevice[] =
    target === 'auto'
      ? ['webnn', 'webgpu', 'cpu']
      : target === 'cpu'
        ? ['cpu']
        : target === 'webgpu'
          ? ['webgpu']
          : ['webnn'];

  for (const candidate of order) {
    const probed = await probeOne(candidate, opts);
    if (probed) return probed;
  }
  return null;
}

/**
 * Attach a `GPUDevice.lost` handler. Exported so consumers that acquire a device
 * some other way (or want to re-arm after re-probing) share ONE loss-handling
 * decision instead of re-implementing the `reason === 'destroyed'` filter.
 */
export function watchDeviceLoss(device: GPUDevice, onLost: (info: GPUDeviceLostInfo) => void): void {
  void device.lost.then((info) => {
    // A deliberate device.destroy() also resolves `lost`; that's not a fault.
    if (info.reason === 'destroyed') return;
    onLost(info);
  });
}

async function probeOne(kind: ActiveDevice, opts: ProbeOptions): Promise<ProbedDevice | null> {
  if (kind === 'webnn') return probeWebNN();
  if (kind === 'webgpu') return probeWebGPU(opts);
  return probeCpu();
}

async function probeWebNN(): Promise<ProbedDevice | null> {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & NavigatorWithMl;
  if (!nav.ml || typeof nav.ml.createContext !== 'function') return null;

  for (const deviceType of ['npu', 'gpu'] as const) {
    try {
      const ctx = await nav.ml.createContext({ deviceType, powerPreference: 'high-performance' });
      if (ctx) {
        return {
          kind: 'webnn',
          mlContext: ctx,
          label: `WebNN (${deviceType.toUpperCase()})`,
          approxMemoryMb: null,
        };
      }
    } catch {
      // Try the next deviceType, then fall through to WebGPU.
    }
  }
  return null;
}

async function probeWebGPU(opts: ProbeOptions): Promise<ProbedDevice | null> {
  if (!hasWebGPUSupport()) return null;
  const nav = navigator as Navigator & GpuWithRequestAdapter;
  if (!nav.gpu) return null;

  try {
    const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;

    const device = await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: Math.min(adapter.limits.maxBufferSize, 2_147_483_648),
        maxStorageBufferBindingSize: Math.min(
          adapter.limits.maxStorageBufferBindingSize,
          2_147_483_648
        ),
      },
    });

    // Context-loss recovery: surface a lost device to the consumer (which
    // re-probes + rebuilds). Without this the studio silently breaks after a
    // GPU reset. Default handler warns so a loss is never wholly silent.
    watchDeviceLoss(device, (info) => {
      console.warn('[device-router] WebGPU device lost:', info.message || info.reason);
      opts.onDeviceLost?.(info);
    });

    const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
    const label = [info?.vendor, info?.architecture, info?.device].filter(Boolean).join(' ') || 'WebGPU device';

    // approxMemoryMb stays `null` for WebGPU on purpose: the API doesn't
    // expose real VRAM. The previous estimate used `adapter.limits.maxBufferSize`
    // which is a SPEC LIMIT (2 GB default), not memory — it was falsely
    // blocking 16GB GPUs as "insufficient." `null` is honest.
    return { kind: 'webgpu', gpuDevice: device, label, approxMemoryMb: null };
  } catch {
    return null;
  }
}

function probeCpu(): ProbedDevice {
  return {
    kind: 'cpu',
    label: 'CPU (WASM SIMD)',
    approxMemoryMb: null,
  };
}
