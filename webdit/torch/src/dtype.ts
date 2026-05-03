/**
 * Numeric dtypes supported by the V0 tensor library. Float32 covers all
 * activation paths; int32/int64 are needed for embedding indices and shape
 * tensors. No float16/bfloat16 here — quantized weights live in @webdit/shared
 * and are dequantized to float32 before being wrapped in tensors.
 */

export type DType = "float32" | "int32" | "int64";

export type AnyTypedArray = Float32Array | Int32Array | BigInt64Array;

export function newTypedArray(dtype: DType, length: number): AnyTypedArray {
  switch (dtype) {
    case "float32":
      return new Float32Array(length);
    case "int32":
      return new Int32Array(length);
    case "int64":
      return new BigInt64Array(length);
  }
}

export function dtypeBytes(dtype: DType): number {
  switch (dtype) {
    case "float32":
    case "int32":
      return 4;
    case "int64":
      return 8;
  }
}

export function isFloatDType(dtype: DType): boolean {
  return dtype === "float32";
}
