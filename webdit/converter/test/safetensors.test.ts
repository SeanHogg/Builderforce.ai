import { describe, it, expect } from "vitest";
import { parseSafetensors } from "../src/safetensors";
import { floatToHalf } from "../src/half";

function buildSafetensors(
  tensors: Array<{ name: string; dtype: "F32" | "F16" | "BF16"; shape: number[]; bytes: Uint8Array }>,
): Uint8Array {
  let offset = 0;
  const header: Record<string, unknown> = {};
  for (const t of tensors) {
    header[t.name] = {
      dtype: t.dtype,
      shape: t.shape,
      data_offsets: [offset, offset + t.bytes.byteLength],
    };
    offset += t.bytes.byteLength;
  }
  const headerJson = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + headerJson.byteLength + offset);
  new DataView(out.buffer).setBigUint64(0, BigInt(headerJson.byteLength), true);
  out.set(headerJson, 8);
  let cursor = 8 + headerJson.byteLength;
  for (const t of tensors) {
    out.set(t.bytes, cursor);
    cursor += t.bytes.byteLength;
  }
  return out;
}

describe("parseSafetensors", () => {
  it("decodes a single F32 tensor", () => {
    const data = new Float32Array([1, 2, -3, 4]);
    const bytes = new Uint8Array(data.buffer);
    const blob = buildSafetensors([{ name: "w", dtype: "F32", shape: [2, 2], bytes }]);
    const [t] = parseSafetensors(blob);
    expect(t!.name).toBe("w");
    expect(t!.shape).toEqual([2, 2]);
    expect(Array.from(t!.data)).toEqual([1, 2, -3, 4]);
  });

  it("decodes F16 by converting to FP32", () => {
    const u16 = new Uint16Array([floatToHalf(1.5), floatToHalf(-0.25)]);
    const bytes = new Uint8Array(u16.buffer);
    const blob = buildSafetensors([{ name: "w", dtype: "F16", shape: [2], bytes }]);
    const [t] = parseSafetensors(blob);
    expect(t!.data[0]).toBeCloseTo(1.5);
    expect(t!.data[1]).toBeCloseTo(-0.25);
  });

  it("decodes BF16 by converting to FP32", () => {
    const u16 = new Uint16Array([0x3f80, 0x4040]); // 1.0, 3.0
    const bytes = new Uint8Array(u16.buffer);
    const blob = buildSafetensors([{ name: "w", dtype: "BF16", shape: [2], bytes }]);
    const [t] = parseSafetensors(blob);
    expect(t!.data[0]).toBe(1.0);
    expect(t!.data[1]).toBe(3.0);
  });

  it("skips the __metadata__ pseudo-entry", () => {
    const headerObj = {
      __metadata__: { format: "test" },
      w: { dtype: "F32", shape: [1], data_offsets: [0, 4] },
    };
    const headerJson = new TextEncoder().encode(JSON.stringify(headerObj));
    const data = new Uint8Array(new Float32Array([7]).buffer);
    const blob = new Uint8Array(8 + headerJson.byteLength + data.byteLength);
    new DataView(blob.buffer).setBigUint64(0, BigInt(headerJson.byteLength), true);
    blob.set(headerJson, 8);
    blob.set(data, 8 + headerJson.byteLength);
    const tensors = parseSafetensors(blob);
    expect(tensors.length).toBe(1);
    expect(tensors[0]!.name).toBe("w");
  });

  it("rejects unsupported dtypes", () => {
    const headerObj = {
      w: { dtype: "I32", shape: [1], data_offsets: [0, 4] },
    };
    const headerJson = new TextEncoder().encode(JSON.stringify(headerObj));
    const blob = new Uint8Array(8 + headerJson.byteLength + 4);
    new DataView(blob.buffer).setBigUint64(0, BigInt(headerJson.byteLength), true);
    blob.set(headerJson, 8);
    expect(() => parseSafetensors(blob)).toThrow(/I32/);
  });

  it("rejects truncated headers", () => {
    const blob = new Uint8Array(4); // too short
    expect(() => parseSafetensors(blob)).toThrow(/8-byte header/);
  });
});
