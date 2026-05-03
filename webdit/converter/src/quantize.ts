import type { WebDiTQuantization } from "@webdit/shared";
import { floatToHalf, halfToFloat } from "./half";

/** Group size for q4f16_1 — fixed by the format spec. */
export const Q4_GROUP = 32;

export interface QuantizedTensor {
  /** Packed quantized data. */
  data: Uint8Array;
  /** FP16 scales. Length = 1 for q8f16_0, length = numGroups for q4f16_1, length = 0 for f16. */
  scales: Uint16Array;
  shape: readonly number[];
  quantization: WebDiTQuantization;
}

export function quantize(
  tensor: Float32Array,
  shape: readonly number[],
  mode: WebDiTQuantization,
): QuantizedTensor {
  switch (mode) {
    case "f16":
      return quantizeF16(tensor, shape);
    case "q8f16_0":
      return quantizeQ8(tensor, shape);
    case "q4f16_1":
      return quantizeQ4(tensor, shape);
  }
}

function quantizeF16(tensor: Float32Array, shape: readonly number[]): QuantizedTensor {
  const out = new Uint16Array(tensor.length);
  for (let i = 0; i < tensor.length; i++) out[i] = floatToHalf(tensor[i]!);
  return {
    data: new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
    scales: new Uint16Array(0),
    shape,
    quantization: "f16",
  };
}

function quantizeQ8(tensor: Float32Array, shape: readonly number[]): QuantizedTensor {
  const absMax = absMaxOf(tensor, 0, tensor.length);
  const scale = absMax / 127;
  const out = new Int8Array(tensor.length);
  if (scale > 0) {
    const inv = 1 / scale;
    for (let i = 0; i < tensor.length; i++) {
      out[i] = clampInt(Math.round(tensor[i]! * inv), -128, 127);
    }
  }
  return {
    data: new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
    scales: new Uint16Array([floatToHalf(scale)]),
    shape,
    quantization: "q8f16_0",
  };
}

function quantizeQ4(tensor: Float32Array, shape: readonly number[]): QuantizedTensor {
  if (tensor.length % Q4_GROUP !== 0) {
    throw new Error(
      `q4f16_1 requires tensor length divisible by ${Q4_GROUP}; got ${tensor.length}`,
    );
  }
  const numGroups = tensor.length / Q4_GROUP;
  const scales = new Uint16Array(numGroups);
  const packed = new Uint8Array(tensor.length / 2);

  for (let g = 0; g < numGroups; g++) {
    const base = g * Q4_GROUP;
    const absMax = absMaxOf(tensor, base, Q4_GROUP);
    const scale = absMax / 7;
    scales[g] = floatToHalf(scale);
    if (scale === 0) continue;
    const inv = 1 / scale;
    for (let i = 0; i < Q4_GROUP; i += 2) {
      const a = clampInt(Math.round(tensor[base + i]! * inv), -8, 7);
      const b = clampInt(Math.round(tensor[base + i + 1]! * inv), -8, 7);
      packed[(base + i) / 2] = ((b & 0xf) << 4) | (a & 0xf);
    }
  }

  return { data: packed, scales, shape, quantization: "q4f16_1" };
}

function absMaxOf(tensor: Float32Array, start: number, len: number): number {
  let m = 0;
  for (let i = 0; i < len; i++) {
    const a = Math.abs(tensor[start + i]!);
    if (a > m) m = a;
  }
  return m;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Reverse the quantization for testing / verification. */
export function dequantize(q: QuantizedTensor): Float32Array {
  switch (q.quantization) {
    case "f16": {
      const u16 = new Uint16Array(q.data.buffer, q.data.byteOffset, q.data.byteLength / 2);
      const out = new Float32Array(u16.length);
      for (let i = 0; i < u16.length; i++) out[i] = halfToFloat(u16[i]!);
      return out;
    }
    case "q8f16_0": {
      const i8 = new Int8Array(q.data.buffer, q.data.byteOffset, q.data.byteLength);
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
