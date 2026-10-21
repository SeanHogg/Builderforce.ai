/**
 * `bfi`'s support record WITHOUT the wasm — for the picker on a device with no Bonsai
 * downloaded yet. Listing the catalog must not start a worker or compile 3.7 MB of wasm
 * just to say "Download (250 MB)", so until a model is in the store the record is built
 * from what the page itself can read: the WebGPU adapter (no device), WebAssembly SIMD
 * (the default artifact needs it to instantiate at all), and the CPU planning constants
 * Rust generates (`BFI_CPU_LIMITS`, `cpuMemoryCeiling`). Once a model is downloaded the
 * engine's own `BfiEngine.support()` answers.
 */
import {
  BFI_CPU_LIMITS,
  cpuMemoryCeiling,
  localCatalogFor,
  type LocalBackend,
  type LocalDeviceSupport,
} from '@builderforce/local-inference';
import type { HfModelStore } from './hfModelStore';
import { webGpuSupport } from './webgpu';

/** THE record for "this host cannot run `bfi` at all" (its wasm, its worker or its
 *  support read failed — the reason is reported where it happened). */
export const BFI_UNSUPPORTED: LocalDeviceSupport = { supported: false, reason: 'bfi_unavailable', f16: false, maxBufferBytes: 0 };

/** Whether the store holds any Bonsai model — the one check that decides whether the
 *  wasm (or its worker) is needed yet. A failed lookup reads as "not downloaded". */
export async function anyBfiModelDownloaded(store: Pick<HfModelStore, 'status'>): Promise<boolean> {
  const states = await Promise.all(localCatalogFor('bfi').map((row) => store.status(row.ref).catch(() => 'absent' as const)));
  return states.includes('ready');
}

/** `support` restricted to the backends a host RUNS `bfi` on: any other backend reads as
 *  unsupported. Applied to the probe and the chat only — what this host may SERVE. */
export function restrictBackends(s: LocalDeviceSupport, backends: readonly LocalBackend[]): LocalDeviceSupport {
  const gpu = backends.includes('webgpu');
  const out: LocalDeviceSupport = gpu ? { ...s } : { ...s, supported: false, reason: 'webgpu_not_used_here' };
  const { cpu, webgpu } = s.backends ?? {};
  out.backends = {
    ...(webgpu ? { webgpu: gpu ? webgpu : { ...webgpu, supported: false, reason: 'webgpu_not_used_here' } } : {}),
    ...(cpu && backends.includes('cpu') ? { cpu } : {}),
  };
  return out;
}

/**
 * The PICKER's record where `bfi`'s backends are split across two places — the editor's
 * webview runs WebGPU, the extension host's worker runs the CPU: this host's own record
 * for the backends it runs, the peer's for the rest. So a model that only fits the CPU is
 * offered for download here and served there. Without a peer it is
 * {@link restrictBackends}.
 */
export function withPeerBackends(
  own: LocalDeviceSupport,
  backends: readonly LocalBackend[],
  peer: LocalDeviceSupport | undefined,
): LocalDeviceSupport {
  const local = restrictBackends(own, backends);
  if (!peer) return local;
  const top = backends.includes('webgpu') ? local : { ...local, ...topLevel(peer) };
  return {
    ...top,
    backends: {
      ...(backends.includes('webgpu') ? pick(local, 'webgpu') : pick(peer, 'webgpu')),
      ...(backends.includes('cpu') ? pick(local, 'cpu') : pick(peer, 'cpu')),
    },
  };
}

/** The WebGPU adapter fields of a record (its top level). */
function topLevel(s: LocalDeviceSupport): Omit<LocalDeviceSupport, 'backends'> {
  const { backends: _backends, ...rest } = s;
  return rest;
}

function pick<K extends LocalBackend>(s: LocalDeviceSupport, key: K): Pick<NonNullable<LocalDeviceSupport['backends']>, K> {
  const value = s.backends?.[key];
  return (value ? { [key]: value } : {}) as Pick<NonNullable<LocalDeviceSupport['backends']>, K>;
}

/** A minimal module using a SIMD128 instruction — `WebAssembly.validate` accepts it only
 *  where SIMD is supported (the wasm-feature-detect probe). */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export function wasmSimdSupported(): boolean {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

/** `navigator.deviceMemory` in bytes, where the browser reports it. */
export function reportedDeviceMemoryBytes(): number | undefined {
  const gb = (globalThis as { navigator?: { deviceMemory?: number } }).navigator?.deviceMemory;
  return typeof gb === 'number' && gb > 0 ? gb * 1024 ** 3 : undefined;
}

/** The support record `BfiEngine.support()` would give, read without the engine. */
export async function bfiSupportWithoutWasm(deviceMemoryBytes = reportedDeviceMemoryBytes()): Promise<LocalDeviceSupport> {
  const simd = wasmSimdSupported();
  const gpu = await webGpuSupport();
  const webgpu = simd ? gpu : { ...gpu, supported: false, reason: 'wasm_simd_unavailable' };
  return {
    ...webgpu,
    backends: {
      webgpu: {
        supported: webgpu.supported,
        ...(webgpu.reason ? { reason: webgpu.reason } : {}),
        maxBufferBytes: webgpu.maxBufferBytes,
        maxStorageBufferBindingSizeBytes: webgpu.maxStorageBufferBindingSizeBytes ?? 0,
        f16: webgpu.f16,
      },
      cpu: {
        supported: simd,
        simd,
        threads: 1,
        kvBudgetBytes: BFI_CPU_LIMITS.cpuKvBudgetBytes,
        maxMemoryBytes: cpuMemoryCeiling(deviceMemoryBytes),
        ...(deviceMemoryBytes ? { deviceMemoryBytes } : {}),
      },
    },
  };
}
