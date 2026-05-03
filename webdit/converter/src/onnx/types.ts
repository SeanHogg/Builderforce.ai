/**
 * ONNX type enums + structural interfaces. We hand-encode/decode ONNX
 * protobuf, so these mirror the public-facing parts of onnx.proto3 we use.
 */

/** TensorProto.DataType — see https://github.com/onnx/onnx/blob/main/onnx/onnx.proto3 */
export const TensorDataType = {
  UNDEFINED: 0,
  FLOAT: 1,
  UINT8: 2,
  INT8: 3,
  UINT16: 4,
  INT16: 5,
  INT32: 6,
  INT64: 7,
  STRING: 8,
  BOOL: 9,
  FLOAT16: 10,
  DOUBLE: 11,
  UINT32: 12,
  UINT64: 13,
  BFLOAT16: 16,
} as const;
export type TensorDataType = (typeof TensorDataType)[keyof typeof TensorDataType];

/** AttributeProto.AttributeType */
export const AttributeType = {
  UNDEFINED: 0,
  FLOAT: 1,
  INT: 2,
  STRING: 3,
  TENSOR: 4,
  GRAPH: 5,
  FLOATS: 6,
  INTS: 7,
  STRINGS: 8,
} as const;
export type AttributeType = (typeof AttributeType)[keyof typeof AttributeType];

/** Symbolic dim ("T", "L", ...) or fixed dim (int). */
export type OnnxDim = number | string;

export interface OnnxValueInfo {
  name: string;
  dtype: TensorDataType;
  shape: OnnxDim[];
}

export interface OnnxTensor {
  name: string;
  dtype: TensorDataType;
  shape: number[];
  /** Raw little-endian bytes, length = product(shape) * sizeof(dtype). */
  data: Uint8Array;
}

export interface OnnxAttribute {
  name: string;
  type: AttributeType;
  i?: number | bigint;
  f?: number;
  s?: string;
  ints?: ReadonlyArray<number | bigint>;
  floats?: ReadonlyArray<number>;
  strings?: ReadonlyArray<string>;
}

export interface OnnxNode {
  opType: string;
  inputs: string[];
  outputs: string[];
  name?: string;
  attributes?: OnnxAttribute[];
  domain?: string;
}

export interface OnnxGraph {
  name: string;
  inputs: OnnxValueInfo[];
  outputs: OnnxValueInfo[];
  initializers: OnnxTensor[];
  nodes: OnnxNode[];
}

export interface OnnxModel {
  irVersion: number;
  producerName: string;
  producerVersion?: string;
  opsetVersion: number;
  graph: OnnxGraph;
}

/** Number of bytes per element for raw_data of a given dtype. */
export function dtypeSize(dtype: TensorDataType): number {
  switch (dtype) {
    case TensorDataType.FLOAT:
    case TensorDataType.INT32:
    case TensorDataType.UINT32:
      return 4;
    case TensorDataType.INT64:
    case TensorDataType.UINT64:
    case TensorDataType.DOUBLE:
      return 8;
    case TensorDataType.INT16:
    case TensorDataType.UINT16:
    case TensorDataType.FLOAT16:
    case TensorDataType.BFLOAT16:
      return 2;
    case TensorDataType.INT8:
    case TensorDataType.UINT8:
    case TensorDataType.BOOL:
      return 1;
    default:
      throw new Error(`dtypeSize: unsupported dtype ${dtype}`);
  }
}
