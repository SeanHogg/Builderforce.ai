/**
 * IEEE 754 binary16 (FP16) <-> binary32 (FP32) conversion.
 *
 * Used by both the quantizer (FP32 weights -> FP16 / quantized scales) and
 * the safetensors reader (FP16 / BF16 source weights -> FP32 working buffer).
 * Single source of truth so we never re-derive the half-float bit layout in
 * two places.
 */

const f32buf = new ArrayBuffer(4);
const f32 = new Float32Array(f32buf);
const u32 = new Uint32Array(f32buf);

export function floatToHalf(val: number): number {
  f32[0] = val;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  let mant = x & 0x007fffff;
  let exp = (x >>> 23) & 0xff;

  if (exp === 0xff) {
    return sign | 0x7c00 | (mant ? 1 : 0);
  }
  exp = exp - 127 + 15;
  if (exp >= 0x1f) return sign | 0x7c00;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x00800000) >>> (1 - exp);
    return sign | (mant >>> 13);
  }
  return sign | (exp << 10) | (mant >>> 13);
}

export function halfToFloat(half: number): number {
  const sign = (half & 0x8000) << 16;
  const exp = (half & 0x7c00) >>> 10;
  const mant = half & 0x03ff;

  if (exp === 0) {
    if (mant === 0) {
      u32[0] = sign;
      return f32[0]!;
    }
    const s = sign ? -1 : 1;
    return s * (mant / 0x400) * Math.pow(2, -14);
  }
  if (exp === 0x1f) {
    u32[0] = sign | 0x7f800000 | (mant << 13);
    return f32[0]!;
  }
  u32[0] = sign | ((exp - 15 + 127) << 23) | (mant << 13);
  return f32[0]!;
}

const bf16buf = new ArrayBuffer(4);
const bf16f32 = new Float32Array(bf16buf);
const bf16u32 = new Uint32Array(bf16buf);

export function bfloat16ToFloat(half: number): number {
  bf16u32[0] = half << 16;
  return bf16f32[0]!;
}
