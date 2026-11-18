import type { DeviceTensor } from "./device-tensor";

/**
 * Index validation that behaves the same on every backend.
 *
 * An int32 index tensor built from host values (`intTensor`, `fromTensor`,
 * `toBackend`) remembers them here, and `embedding` / `cross_entropy` check
 * the range BEFORE dispatch — so an out-of-range id throws the same error on
 * the CPU reference and on WebGPU, with no readback.
 *
 * Device-resident indices (produced on the GPU, never seen by the host) are
 * not checked: reading them back would stall the queue. There the WebGPU
 * kernels stay memory-safe instead — `embedding` reads an out-of-range id as a
 * zero row (and its gradient drops it), `cross_entropy` clamps the target into
 * [0, C) in forward and backward alike. The CPU backend always throws.
 *
 * The host values also feed the embedding gradient: with them the WebGPU
 * backend groups positions by row up front (deterministic CSR kernel); without
 * them it scatters on the device with atomics.
 */

const hostValues = new WeakMap<DeviceTensor, Int32Array>();

export function rememberHostIndices(t: DeviceTensor, values: Int32Array): void {
  hostValues.set(t, values);
}

/** A view with the same values (reshape) keeps its source's host indices. */
export function carryHostIndices(from: DeviceTensor, to: DeviceTensor): DeviceTensor {
  const values = hostValues.get(from);
  if (values) hostValues.set(to, values);
  return to;
}

/** The host-known values of an index tensor, or null for a device-resident one. */
export function hostIndicesOf(t: DeviceTensor): Int32Array | null {
  return hostValues.get(t) ?? null;
}

/** `allowed` is a sentinel that is not an index (cross-entropy's `ignoreIndex`). */
export function checkIndexRange(op: string, t: DeviceTensor, limit: number, allowed?: number): void {
  const values = hostValues.get(t);
  if (!values) return;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v === allowed) continue;
    if (v < 0 || v >= limit) throw new RangeError(`${op}: index ${v} at position ${i} out of range [0, ${limit})`);
  }
}
