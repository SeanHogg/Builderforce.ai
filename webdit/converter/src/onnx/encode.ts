/**
 * ONNX message encoders. Each returns the message body bytes; parents
 * length-prefix and embed via writeMessageField.
 *
 * Field numbers come from onnx.proto3. Comments cite the field by name.
 */
import { ProtobufWriter } from "./protobuf";
import {
  AttributeType,
  type OnnxAttribute,
  type OnnxGraph,
  type OnnxModel,
  type OnnxNode,
  type OnnxTensor,
  type OnnxValueInfo,
  TensorDataType,
} from "./types";

export function encodeTensor(t: OnnxTensor): Uint8Array {
  const w = new ProtobufWriter();
  // dims (1) — repeated int64, packed
  w.writePackedInt64Field(1, t.shape);
  // data_type (2) — int32
  w.writeVarintField(2, t.dtype);
  // name (8)
  w.writeStringField(8, t.name);
  // raw_data (9) — bytes
  w.writeBytesField(9, t.data);
  return w.toBytes();
}

function encodeTensorShape(dims: ReadonlyArray<number | string>): Uint8Array {
  // TensorShapeProto: dim (1) — repeated Dimension
  const w = new ProtobufWriter();
  for (const d of dims) {
    const dim = new ProtobufWriter();
    if (typeof d === "number") {
      // Dimension.dim_value (1) — int64
      dim.writeVarintField(1, d);
    } else {
      // Dimension.dim_param (2) — string
      dim.writeStringField(2, d);
    }
    w.writeMessageField(1, dim.toBytes());
  }
  return w.toBytes();
}

function encodeTypeProtoTensor(dtype: TensorDataType, shape: ReadonlyArray<number | string>): Uint8Array {
  // TypeProto.Tensor: elem_type (1) — int32, shape (2) — TensorShapeProto
  const tensor = new ProtobufWriter();
  tensor.writeVarintField(1, dtype);
  tensor.writeMessageField(2, encodeTensorShape(shape));

  // TypeProto: tensor_type (1) — TypeProto.Tensor
  const tp = new ProtobufWriter();
  tp.writeMessageField(1, tensor.toBytes());
  return tp.toBytes();
}

export function encodeValueInfo(v: OnnxValueInfo): Uint8Array {
  const w = new ProtobufWriter();
  // name (1)
  w.writeStringField(1, v.name);
  // type (2) — TypeProto
  w.writeMessageField(2, encodeTypeProtoTensor(v.dtype, v.shape));
  return w.toBytes();
}

export function encodeAttribute(a: OnnxAttribute): Uint8Array {
  const w = new ProtobufWriter();
  // name (1)
  w.writeStringField(1, a.name);
  // type (20)
  w.writeVarintField(20, a.type);
  switch (a.type) {
    case AttributeType.FLOAT:
      // f (2)
      if (a.f !== undefined) w.writeFloatField(2, a.f);
      break;
    case AttributeType.INT:
      // i (3)
      if (a.i !== undefined) w.writeVarintField(3, a.i);
      break;
    case AttributeType.STRING:
      // s (4) — bytes
      if (a.s !== undefined) w.writeStringField(4, a.s);
      break;
    case AttributeType.FLOATS:
      // floats (7) — packed
      if (a.floats) w.writePackedFloatField(7, a.floats);
      break;
    case AttributeType.INTS:
      // ints (8) — packed
      if (a.ints) w.writePackedInt64Field(8, a.ints);
      break;
    case AttributeType.STRINGS:
      // strings (9) — repeated bytes (NOT packed)
      for (const s of a.strings ?? []) w.writeStringField(9, s);
      break;
    default:
      throw new Error(`encodeAttribute: unsupported attribute type ${a.type} for '${a.name}'`);
  }
  return w.toBytes();
}

export function encodeNode(n: OnnxNode): Uint8Array {
  const w = new ProtobufWriter();
  // input (1) — repeated string
  for (const inp of n.inputs) w.writeStringField(1, inp);
  // output (2) — repeated string
  for (const out of n.outputs) w.writeStringField(2, out);
  // name (3)
  if (n.name) w.writeStringField(3, n.name);
  // op_type (4)
  w.writeStringField(4, n.opType);
  // attribute (5) — repeated AttributeProto
  for (const attr of n.attributes ?? []) {
    w.writeMessageField(5, encodeAttribute(attr));
  }
  // domain (7)
  if (n.domain) w.writeStringField(7, n.domain);
  return w.toBytes();
}

export function encodeGraph(g: OnnxGraph): Uint8Array {
  const w = new ProtobufWriter();
  // node (1) — repeated NodeProto
  for (const n of g.nodes) w.writeMessageField(1, encodeNode(n));
  // name (2)
  w.writeStringField(2, g.name);
  // initializer (5) — repeated TensorProto
  for (const t of g.initializers) w.writeMessageField(5, encodeTensor(t));
  // input (11) — repeated ValueInfoProto
  for (const i of g.inputs) w.writeMessageField(11, encodeValueInfo(i));
  // output (12) — repeated ValueInfoProto
  for (const o of g.outputs) w.writeMessageField(12, encodeValueInfo(o));
  return w.toBytes();
}

function encodeOpsetId(domain: string, version: number): Uint8Array {
  const w = new ProtobufWriter();
  // domain (1)
  if (domain) w.writeStringField(1, domain);
  // version (2)
  w.writeVarintField(2, version);
  return w.toBytes();
}

export function encodeModel(m: OnnxModel): Uint8Array {
  const w = new ProtobufWriter();
  // ir_version (1) — int64
  w.writeVarintField(1, m.irVersion);
  // producer_name (2)
  w.writeStringField(2, m.producerName);
  if (m.producerVersion) w.writeStringField(3, m.producerVersion);
  // graph (7)
  w.writeMessageField(7, encodeGraph(m.graph));
  // opset_import (8) — repeated OperatorSetIdProto, default domain ""
  w.writeMessageField(8, encodeOpsetId("", m.opsetVersion));
  return w.toBytes();
}
