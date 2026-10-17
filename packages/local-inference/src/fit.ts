/**
 * Can THIS device run a catalog model? Answered from what the GPU reports — WebGPU
 * present, `shader-f16` offered, the largest buffer binding it grants — before anyone
 * downloads a gigabyte to find out. Pure: the host asks its engine for the support
 * record (`BfiEngine.support()` or a WebGPU adapter read) and passes it in.
 */

import type { LocalCatalogModel } from './catalog.js';

/** What the device's WebGPU adapter offers. Never requires creating a device. */
export interface LocalDeviceSupport {
  supported: boolean;
  /** Why WebGPU is unavailable, when `supported` is false. */
  reason?: string;
  f16: boolean;
  /** The largest storage-buffer binding the adapter grants. */
  maxBufferBytes: number;
}

/** Why a model cannot run here — a stable code a picker maps to copy. */
export type LocalModelUnfit = 'webgpu_unavailable' | 'shader_f16_unavailable' | 'buffer_too_small';

export type LocalModelFit = { fits: true } | { fits: false; reason: LocalModelUnfit; detail?: string };

export function localModelFit(
  model: Pick<LocalCatalogModel, 'requires'>,
  support: LocalDeviceSupport,
): LocalModelFit {
  if (!support.supported) {
    return { fits: false, reason: 'webgpu_unavailable', ...(support.reason ? { detail: support.reason } : {}) };
  }
  if (model.requires.f16 && !support.f16) return { fits: false, reason: 'shader_f16_unavailable' };
  if (support.maxBufferBytes < model.requires.minBufferBytes) return { fits: false, reason: 'buffer_too_small' };
  return { fits: true };
}
