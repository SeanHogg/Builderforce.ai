import type { DeviceTensor } from "../autograd/device-tensor";

/**
 * `torch.save` / `torch.load` bytes: safetensors through the ONE codec the
 * platform already ships (`@seanhogg/builderforce-memory-engine`'s
 * `tensorsToSafetensors` / `safetensorsToTensors` — the browser trainer's
 * adapter export uses the same pair). Loaded lazily, so a training worker that
 * never saves does not load the engine bundle.
 *
 * Every entry is stored F32 (the codec's format; F16/BF16 files widen to F32 on
 * load). An int tensor in a state dict is refused by name rather than silently
 * turned into floats.
 */

const codec = () => import("@seanhogg/builderforce-memory-engine");

export async function encodeStateDict(entries: ReadonlyArray<[string, DeviceTensor]>, metadata: Record<string, string> = {}): Promise<Uint8Array> {
  const named = [];
  for (const [name, t] of entries) {
    if (t.dtype !== "float32") throw new Error(`torch.save: "${name}" is ${t.dtype}; only float32 tensors are saved (safetensors F32)`);
    named.push({ name, shape: [...t.shape], data: (await t.data()) as Float32Array });
  }
  const { tensorsToSafetensors } = await codec();
  return tensorsToSafetensors(named, { metadata: { format: "pt", producer: "@webdit/torch", ...metadata } });
}

/** Decode `bytes` into host values, in file order (the caller uploads them where it tracks them). */
export async function decodeStateDict(bytes: Uint8Array): Promise<Array<{ name: string; shape: number[]; data: Float32Array }>> {
  const { safetensorsToTensors } = await codec();
  return safetensorsToTensors(bytes);
}

/**
 * Exact in-place copy of `src`'s values into `dst` (same shape, dtype and
 * backend) through the backend's `copyInPlace` — bit-exact whatever `dst`
 * held (NaN/Inf included), and a no-op when `src` is a view of `dst` (loading a
 * model's own `state_dict()`). In place, so an optimizer holding `dst` keeps
 * working after `load_state_dict`.
 */
export function copyInto(dst: DeviceTensor, src: DeviceTensor): void {
  if (dst.backend !== src.backend) throw new Error("copy_: source lives on a different device");
  if (dst.dtype !== src.dtype) throw new Error(`copy_: cannot copy ${src.dtype} into ${dst.dtype} in place; cast first`);
  if (dst.shape.length !== src.shape.length || dst.shape.some((d, i) => d !== src.shape[i])) {
    throw new Error(`copy_: shape [${src.shape.join(", ")}] does not match [${dst.shape.join(", ")}]`);
  }
  dst.backend.copyInPlace(dst.handle, src.handle);
}
