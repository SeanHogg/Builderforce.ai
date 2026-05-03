/**
 * Write-side quantization. Read-side primitives (QuantizedTensor type,
 * dequantize, half conversions) live in @webdit/shared so the runtime can
 * read shards without depending on the converter.
 */
import {
  Q4_GROUP,
  floatToHalf,
  type QuantizedTensor,
  type WebDiTQuantization,
} from "@webdit/shared";

export { dequantize, Q4_GROUP, type QuantizedTensor } from "@webdit/shared";

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
