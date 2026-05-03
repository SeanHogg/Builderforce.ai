import { describe, it, expect } from "vitest";
import { ProtobufReader, ProtobufWriter } from "../src/onnx/protobuf";

describe("ProtobufWriter varint encoding", () => {
  function bytesOf(write: (w: ProtobufWriter) => void): number[] {
    const w = new ProtobufWriter();
    write(w);
    return Array.from(w.toBytes());
  }

  it("encodes 0 as a single zero byte", () => {
    expect(bytesOf((w) => w.writeVarint(0))).toEqual([0]);
  });

  it("encodes 1..127 as a single byte (no continuation bit)", () => {
    expect(bytesOf((w) => w.writeVarint(1))).toEqual([0x01]);
    expect(bytesOf((w) => w.writeVarint(127))).toEqual([0x7f]);
  });

  it("encodes 128 as [0x80, 0x01]", () => {
    expect(bytesOf((w) => w.writeVarint(128))).toEqual([0x80, 0x01]);
  });

  it("encodes 300 as [0xAC, 0x02] (well-known protobuf example)", () => {
    expect(bytesOf((w) => w.writeVarint(300))).toEqual([0xac, 0x02]);
  });

  it("encodes 16384 as 3 bytes", () => {
    expect(bytesOf((w) => w.writeVarint(16384))).toEqual([0x80, 0x80, 0x01]);
  });

  it("encodes 64-bit values without overflow", () => {
    const v = 0x1234567890abcdefn;
    const bytes = bytesOf((w) => w.writeVarint(v));
    const r = new ProtobufReader(new Uint8Array(bytes));
    expect(r.readVarintBig()).toBe(v);
  });
});

describe("ProtobufWriter / Reader round-trip", () => {
  it("round-trips a string field", () => {
    const w = new ProtobufWriter();
    w.writeStringField(3, "hello");
    const r = new ProtobufReader(w.toBytes());
    const tag = r.readTag();
    expect(tag).toEqual({ fieldNumber: 3, wireType: 2 });
    expect(r.readString()).toBe("hello");
  });

  it("round-trips a fixed32 float field", () => {
    const w = new ProtobufWriter();
    w.writeFloatField(7, -3.14159);
    const r = new ProtobufReader(w.toBytes());
    const tag = r.readTag();
    expect(tag).toEqual({ fieldNumber: 7, wireType: 5 });
    expect(r.readFixed32Float()).toBeCloseTo(-3.14159, 5);
  });

  it("round-trips a packed int64 field", () => {
    const w = new ProtobufWriter();
    w.writePackedInt64Field(1, [1, 2, 3, 0, 127, 128, 65536]);
    const r = new ProtobufReader(w.toBytes());
    r.readTag();
    const inner = new ProtobufReader(r.readBytes());
    const got: number[] = [];
    while (inner.hasMore()) got.push(inner.readVarint());
    expect(got).toEqual([1, 2, 3, 0, 127, 128, 65536]);
  });

  it("round-trips a packed float32 field", () => {
    const w = new ProtobufWriter();
    w.writePackedFloatField(2, [0.5, -1.0, 2.25]);
    const r = new ProtobufReader(w.toBytes());
    r.readTag();
    const inner = new ProtobufReader(r.readBytes());
    expect(inner.readFixed32Float()).toBeCloseTo(0.5);
    expect(inner.readFixed32Float()).toBeCloseTo(-1.0);
    expect(inner.readFixed32Float()).toBeCloseTo(2.25);
  });

  it("round-trips a length-delimited bytes field", () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const w = new ProtobufWriter();
    w.writeBytesField(5, payload);
    const r = new ProtobufReader(w.toBytes());
    r.readTag();
    expect(Array.from(r.readBytes())).toEqual(Array.from(payload));
  });

  it("skip() correctly consumes each wire type", () => {
    const w = new ProtobufWriter();
    w.writeStringField(1, "skip-me");
    w.writeFloatField(2, 1.5);
    w.writeVarintField(3, 999);
    w.writeStringField(4, "keep-me");
    const r = new ProtobufReader(w.toBytes());
    for (let i = 0; i < 3; i++) {
      const t = r.readTag();
      r.skip(t.wireType);
    }
    expect(r.readTag()).toEqual({ fieldNumber: 4, wireType: 2 });
    expect(r.readString()).toBe("keep-me");
  });
});
