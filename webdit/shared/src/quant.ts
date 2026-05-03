/**
 * Shared quantization data formats. The runtime reads quantized shards;
 * the converter writes them. Both sides agree on the byte layout here.
 */
import type { WebDiTQuantization } from "./index";

export const Q4_GROUP = 32;

export interface QuantizedTensor {
  /** Packed quantized data. */
  data: Uint8Array;
  /** FP16 scales. Length = 1 for q8f16_0, length = numGroups for q4f16_1, length = 0 for f16. */
  scales: Uint16Array;
  shape: readonly number[];
  quantization: WebDiTQuantization;
}

const f32buf = new ArrayBuffer(4);
const f32 = new Float32Array(f32buf);
const u32 = new Uint32Array(f32buf);

export function floatToHalf(val: number): number {
  f32[0] = val;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  let mant = x & 0x007fffff;
  let exp = (x >>> 23) & 0xff;

  if (exp === 0xff) return sign | 0x7c00 | (mant ? 1 : 0);
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

/** Reverse the quantization to get FP32 values back. */
export function dequantize(q: QuantizedTensor): Float32Array {
  switch (q.quantization) {
    case "f16": {
      const aligned = new Uint8Array(q.data);
      const u16 = new Uint16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 2);
      const out = new Float32Array(u16.length);
      for (let i = 0; i < u16.length; i++) out[i] = halfToFloat(u16[i]!);
      return out;
    }
    case "q8f16_0": {
      const aligned = new Uint8Array(q.data);
      const i8 = new Int8Array(aligned.buffer, aligned.byteOffset, aligned.byteLength);
      const scale = halfToFloat(q.scales[0]!);
      const out = new Float32Array(i8.length);
      for (let i = 0; i < i8.length; i++) out[i] = i8[i]! * scale;
      return out;
    }
    case "q4f16_1": {
      const out = new Float32Array(q.data.length * 2);
      for (let g = 0; g < q.scales.length; g++) {
        const scale = halfToFloat(q.scales[g]!);
        const base = g * Q4_GROUP;
        for (let i = 0; i < Q4_GROUP; i += 2) {
          const byte = q.data[(base + i) / 2]!;
          out[base + i] = signExtend4(byte & 0xf) * scale;
          out[base + i + 1] = signExtend4((byte >>> 4) & 0xf) * scale;
        }
      }
      return out;
    }
  }
}

function signExtend4(v: number): number {
  return v & 0x8 ? v - 16 : v;
}
