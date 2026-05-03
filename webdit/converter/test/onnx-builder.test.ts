import { describe, it, expect } from "vitest";
import { GraphBuilder } from "../src/onnx/builder";
import { decodeModel } from "../src/onnx/decode";
import { TensorDataType } from "../src/onnx/types";

describe("GraphBuilder", () => {
  it("produces a parseable empty model", () => {
    const bytes = new GraphBuilder().build("empty");
    const model = decodeModel(bytes);
    expect(model.irVersion).toBe(7);
    expect(model.producerName).toBe("@webdit/convert");
    expect(model.opsetVersion).toBe(17);
    expect(model.graph.name).toBe("empty");
    expect(model.graph.nodes).toHaveLength(0);
  });

  it("round-trips inputs / outputs / initializers / nodes through encode→decode", () => {
    const w = new Float32Array([1, 2, 3, 4]);
    const bytes = new GraphBuilder()
      .input("x", TensorDataType.FLOAT, [1, "L", 4])
      .output("y", TensorDataType.FLOAT, [1, "L", 4])
      .initF32("k", w, [4])
      .node("Add", ["x", "k"], ["y"])
      .build("simple");

    const m = decodeModel(bytes);
    expect(m.graph.inputs).toHaveLength(1);
    expect(m.graph.inputs[0]!.name).toBe("x");
    expect(m.graph.inputs[0]!.dtype).toBe(TensorDataType.FLOAT);
    expect(m.graph.inputs[0]!.shape).toEqual([1, "L", 4]);
    expect(m.graph.outputs[0]!.name).toBe("y");
    expect(m.graph.outputs[0]!.shape).toEqual([1, "L", 4]);
    expect(m.graph.initializers).toHaveLength(1);
    expect(m.graph.initializers[0]!.name).toBe("k");
    expect(m.graph.initializers[0]!.shape).toEqual([4]);
    expect(m.graph.initializers[0]!.dtype).toBe(TensorDataType.FLOAT);
    expect(new Float32Array(m.graph.initializers[0]!.data.buffer.slice(0))).toEqual(w);
    expect(m.graph.nodes).toHaveLength(1);
    expect(m.graph.nodes[0]!.opType).toBe("Add");
    expect(m.graph.nodes[0]!.inputs).toEqual(["x", "k"]);
    expect(m.graph.nodes[0]!.outputs).toEqual(["y"]);
  });

  it("rejects an initializer whose data length does not match shape × dtype", () => {
    expect(() =>
      new GraphBuilder().initF32("bad", new Float32Array(5), [4]),
    ).toThrow(/expected 16/);
  });

  it("starts ONNX bytes with non-empty content", () => {
    const bytes = new GraphBuilder().build("any");
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("each node gets a unique auto-generated name", () => {
    const bytes = new GraphBuilder()
      .input("a", TensorDataType.FLOAT, [1])
      .input("b", TensorDataType.FLOAT, [1])
      .output("c", TensorDataType.FLOAT, [1])
      .node("Add", ["a", "b"], ["t1"])
      .node("Add", ["t1", "b"], ["c"])
      .build("dup");
    const m = decodeModel(bytes);
    const names = m.graph.nodes.map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
