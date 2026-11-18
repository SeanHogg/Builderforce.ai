import { GRID_INDEX, MAIN, type KernelEntry } from "./common";

/**
 * fp32 ⇄ fp16 storage casts, compiled only on devices with `shader-f16`.
 * Half storage is read and written in pairs (`vec2<f16>`), so an fp16 buffer
 * holds ceil(n / 2) words and an odd tail is padded with zero.
 * Parameter block: [n].
 */
export const CAST_KERNELS = {
  cast_f32_to_f16: {
    bindings: 3,
    dispatch: "grid",
    requires: "shader-f16",
    wgsl: `
enable f16;
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2<f16>>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${MAIN} {
  ${GRID_INDEX}
  let n = p[0];
  if (idx * 2u >= n) { return; }
  let hi = select(0.0, a[idx * 2u + 1u], idx * 2u + 1u < n);
  out[idx] = vec2<f16>(f16(a[idx * 2u]), f16(hi));
}`,
  },
  cast_f16_to_f32: {
    bindings: 3,
    dispatch: "grid",
    requires: "shader-f16",
    wgsl: `
enable f16;
@group(0) @binding(0) var<storage, read> a: array<vec2<f16>>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@group(0) @binding(2) var<storage, read> p: array<u32>;
${MAIN} {
  ${GRID_INDEX}
  if (idx >= p[0]) { return; }
  let pair = a[idx / 2u];
  out[idx] = f32(select(pair.x, pair.y, idx % 2u == 1u));
}`,
  },
} satisfies Record<string, KernelEntry>;
