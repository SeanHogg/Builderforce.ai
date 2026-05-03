import { encodeModel } from "./encode";
import {
  AttributeType,
  type OnnxAttribute,
  type OnnxDim,
  type OnnxNode,
  type OnnxTensor,
  type OnnxValueInfo,
  TensorDataType,
  dtypeSize,
} from "./types";

/**
 * Fluent ONNX graph builder. Methods return `this` so callers can chain.
 * The model bytes returned by `build()` are an ONNX protobuf payload that
 * any onnx-compatible runtime can load.
 */
export class GraphBuilder {
  private inputs: OnnxValueInfo[] = [];
  private outputs: OnnxValueInfo[] = [];
  private initializers: OnnxTensor[] = [];
  private nodes: OnnxNode[] = [];
  private nodeCounter = 0;

  input(name: string, dtype: TensorDataType, shape: OnnxDim[]): this {
    this.inputs.push({ name, dtype, shape });
    return this;
  }

  output(name: string, dtype: TensorDataType, shape: OnnxDim[]): this {
    this.outputs.push({ name, dtype, shape });
    return this;
  }

  initF32(name: string, data: Float32Array, shape: number[]): this {
    return this.initRaw(
      name,
      TensorDataType.FLOAT,
      shape,
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }

  initInt64(name: string, data: BigInt64Array, shape: number[]): this {
    return this.initRaw(
      name,
      TensorDataType.INT64,
      shape,
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }

  initRaw(name: string, dtype: TensorDataType, shape: number[], data: Uint8Array): this {
    const expected = shape.reduce((p, d) => p * d, 1) * dtypeSize(dtype);
    if (data.byteLength !== expected) {
      throw new Error(
        `initRaw('${name}'): expected ${expected} bytes for shape ${JSON.stringify(shape)} dtype ${dtype}, got ${data.byteLength}`,
      );
    }
    this.initializers.push({ name, dtype, shape, data: new Uint8Array(data) });
    return this;
  }

  node(opType: string, inputs: string[], outputs: string[], attrs?: OnnxAttribute[]): this {
    this.nodes.push({
      opType,
      inputs,
      outputs,
      name: `${opType}_${this.nodeCounter++}`,
      attributes: attrs,
    });
    return this;
  }

  /** Convenience for the common cases. */
  intAttr(name: string, i: number | bigint): OnnxAttribute {
    return { name, type: AttributeType.INT, i };
  }
  intsAttr(name: string, ints: ReadonlyArray<number | bigint>): OnnxAttribute {
    return { name, type: AttributeType.INTS, ints };
  }
  stringAttr(name: string, s: string): OnnxAttribute {
    return { name, type: AttributeType.STRING, s };
  }

  build(graphName: string, opsetVersion = 17, irVersion = 7): Uint8Array {
    return encodeModel({
      irVersion,
      producerName: "@webdit/convert",
      producerVersion: "0.0.1",
      opsetVersion,
      graph: {
        name: graphName,
        inputs: this.inputs,
        outputs: this.outputs,
        initializers: this.initializers,
        nodes: this.nodes,
      },
    });
  }
}
