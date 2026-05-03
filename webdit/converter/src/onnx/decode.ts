/**
 * ONNX message decoders. Used for round-trip tests + the verifier — production
 * never decodes graphs (ORT-Web does that). Only fields we actually emit are
 * decoded; everything else is skipped.
 */
import { ProtobufReader } from "./protobuf";
import type { OnnxGraph, OnnxModel, OnnxNode, OnnxTensor, OnnxValueInfo } from "./types";

export function decodeModel(bytes: Uint8Array): OnnxModel {
  const r = new ProtobufReader(bytes);
  let irVersion = 0;
  let producerName = "";
  let producerVersion: string | undefined;
  let graph: OnnxGraph | undefined;
  let opsetVersion = 0;
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    switch (fieldNumber) {
      case 1: irVersion = r.readVarint(); break;
      case 2: producerName = r.readString(); break;
      case 3: producerVersion = r.readString(); break;
      case 7: graph = decodeGraph(r.readBytes()); break;
      case 8: opsetVersion = decodeOpsetVersion(r.readBytes()); break;
      default: r.skip(wireType);
    }
  }
  if (!graph) throw new Error("decodeModel: missing graph");
  return { irVersion, producerName, producerVersion, opsetVersion, graph };
}

function decodeOpsetVersion(bytes: Uint8Array): number {
  const r = new ProtobufReader(bytes);
  let v = 0;
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 2) v = r.readVarint();
    else r.skip(wireType);
  }
  return v;
}

export function decodeGraph(bytes: Uint8Array): OnnxGraph {
  const r = new ProtobufReader(bytes);
  const nodes: OnnxNode[] = [];
  let name = "";
  const initializers: OnnxTensor[] = [];
  const inputs: OnnxValueInfo[] = [];
  const outputs: OnnxValueInfo[] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    switch (fieldNumber) {
      case 1: nodes.push(decodeNode(r.readBytes())); break;
      case 2: name = r.readString(); break;
      case 5: initializers.push(decodeTensor(r.readBytes())); break;
      case 11: inputs.push(decodeValueInfo(r.readBytes())); break;
      case 12: outputs.push(decodeValueInfo(r.readBytes())); break;
      default: r.skip(wireType);
    }
  }
  return { name, nodes, initializers, inputs, outputs };
}

export function decodeNode(bytes: Uint8Array): OnnxNode {
  const r = new ProtobufReader(bytes);
  const inputs: string[] = [];
  const outputs: string[] = [];
  let name: string | undefined;
  let opType = "";
  let domain: string | undefined;
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    switch (fieldNumber) {
      case 1: inputs.push(r.readString()); break;
      case 2: outputs.push(r.readString()); break;
      case 3: name = r.readString(); break;
      case 4: opType = r.readString(); break;
      case 7: domain = r.readString(); break;
      default: r.skip(wireType);
    }
  }
  return { opType, inputs, outputs, name, domain };
}

export function decodeTensor(bytes: Uint8Array): OnnxTensor {
  const r = new ProtobufReader(bytes);
  let shape: number[] = [];
  let dtype = 0;
  let name = "";
  let data = new Uint8Array(0);
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    switch (fieldNumber) {
      case 1: {
        // dims — packed int64 OR repeated single varint
        if (wireType === 2) {
          const inner = new ProtobufReader(r.readBytes());
          while (inner.hasMore()) shape.push(inner.readVarint());
        } else {
          shape.push(r.readVarint());
        }
        break;
      }
      case 2: dtype = r.readVarint(); break;
      case 8: name = r.readString(); break;
      case 9: data = new Uint8Array(r.readBytes()); break;
      default: r.skip(wireType);
    }
  }
  return { name, dtype: dtype as OnnxTensor["dtype"], shape, data };
}

export function decodeValueInfo(bytes: Uint8Array): OnnxValueInfo {
  const r = new ProtobufReader(bytes);
  let name = "";
  let dtype: OnnxValueInfo["dtype"] = 0;
  let shape: OnnxValueInfo["shape"] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 1 && wireType === 2) name = r.readString();
    else if (fieldNumber === 2 && wireType === 2) {
      const tp = decodeTypeProtoTensor(r.readBytes());
      dtype = tp.dtype;
      shape = tp.shape;
    } else r.skip(wireType);
  }
  return { name, dtype, shape };
}

function decodeTypeProtoTensor(bytes: Uint8Array): { dtype: OnnxValueInfo["dtype"]; shape: OnnxValueInfo["shape"] } {
  const r = new ProtobufReader(bytes);
  let dtype: OnnxValueInfo["dtype"] = 0;
  let shape: OnnxValueInfo["shape"] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 1 && wireType === 2) {
      const inner = new ProtobufReader(r.readBytes());
      while (inner.hasMore()) {
        const f = inner.readTag();
        if (f.fieldNumber === 1) dtype = inner.readVarint() as OnnxValueInfo["dtype"];
        else if (f.fieldNumber === 2) shape = decodeTensorShape(inner.readBytes());
        else inner.skip(f.wireType);
      }
    } else r.skip(wireType);
  }
  return { dtype, shape };
}

function decodeTensorShape(bytes: Uint8Array): OnnxValueInfo["shape"] {
  const r = new ProtobufReader(bytes);
  const dims: OnnxValueInfo["shape"] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 1 && wireType === 2) {
      const inner = new ProtobufReader(r.readBytes());
      let d: number | string | undefined;
      while (inner.hasMore()) {
        const f = inner.readTag();
        if (f.fieldNumber === 1) d = inner.readVarint();
        else if (f.fieldNumber === 2) d = inner.readString();
        else inner.skip(f.wireType);
      }
      if (d !== undefined) dims.push(d);
    } else r.skip(wireType);
  }
  return dims;
}
