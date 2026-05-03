import { describe, it, expect } from "vitest";
import { packShard, parseBundleShard } from "../src/shard-format";
import { quantize, type QuantizedTensor } from "../src/quantize";

function fakeTensor(seed: number): QuantizedTensor {
  const data = new Float32Array(64);
  for (let i = 0; i < 64; i++) data[i] = Math.sin(seed + i);
  return quantize(data, [8, 8], "f16");
}

function tensorsEqual(a: QuantizedTensor, b: QuantizedTensor): boolean {
  return (
    a.quantization === b.quantization &&
    a.shape.length === b.shape.length &&
    a.shape.every((v, i) => v === b.shape[i]) &&
    a.data.byteLength === b.data.byteLength &&
    Array.from(a.data).every((v, i) => v === b.data[i]) &&
    a.scales.length === b.scales.length &&
    Array.from(a.scales).every((v, i) => v === b.scales[i])
  );
}

describe("packShard / parseBundleShard round-trip", () => {
  it("round-trips a single tensor", () => {
    const original = new Map([["w", fakeTensor(1)]]);
    const packed = packShard(Array.from(original.entries()));
    const parsed = parseBundleShard(packed.bytes);
    expect(parsed.tensors.size).toBe(1);
    expect(tensorsEqual(parsed.tensors.get("w")!, original.get("w")!)).toBe(true);
  });

  it("round-trips multiple tensors with different shapes and quantizations", () => {
    const a = quantize(new Float32Array([1, 2, 3, 4]), [4], "f16");
    const b = quantize(new Float32Array(64).fill(0.5), [8, 8], "q4f16_1");
    const c = quantize(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]), [5], "q8f16_0");
    const original = new Map([
      ["a", a],
      ["b", b],
      ["c", c],
    ]);
    const packed = packShard(Array.from(original.entries()));
    const parsed = parseBundleShard(packed.bytes);
    for (const [name, t] of original) {
      expect(tensorsEqual(parsed.tensors.get(name)!, t), `tensor ${name}`).toBe(true);
    }
  });

  it("preserves insertion order of tensorNames", () => {
    const original: Array<[string, QuantizedTensor]> = [
      ["z", fakeTensor(1)],
      ["a", fakeTensor(2)],
      ["m", fakeTensor(3)],
    ];
    const packed = packShard(original);
    expect(packed.tensorNames).toEqual(["z", "a", "m"]);
  });

  it("rejects buffers shorter than the 8-byte length prefix", () => {
    expect(() => parseBundleShard(new Uint8Array(4))).toThrow(/8-byte/);
  });

  it("rejects a header length that exceeds file size", () => {
    const buf = new Uint8Array(16);
    new DataView(buf.buffer).setBigUint64(0, BigInt(1024), true);
    expect(() => parseBundleShard(buf)).toThrow(/exceeds file size/);
  });

  it("rejects a malformed JSON header", () => {
    const headerBytes = new TextEncoder().encode("{not json");
    const buf = new Uint8Array(8 + headerBytes.byteLength);
    new DataView(buf.buffer).setBigUint64(0, BigInt(headerBytes.byteLength), true);
    buf.set(headerBytes, 8);
    expect(() => parseBundleShard(buf)).toThrow(/not valid JSON/);
  });

  it("returns aligned Uint16Array views for scales (q4f16_1 has many scales)", () => {
    const t = quantize(new Float32Array(128).map((_, i) => i / 128), [128], "q4f16_1");
    const packed = packShard([["w", t]]);
    const parsed = parseBundleShard(packed.bytes);
    const restored = parsed.tensors.get("w")!;
    expect(restored.scales.length).toBe(128 / 32);
    expect(restored.scales).toBeInstanceOf(Uint16Array);
  });

  it("reports header and total byte sizes accurately", () => {
    const t = fakeTensor(1);
    const packed = packShard([["w", t]]);
    const parsed = parseBundleShard(packed.bytes);
    expect(parsed.totalBytes).toBe(packed.bytes.byteLength);
    expect(parsed.headerBytes).toBeGreaterThan(8);
    expect(parsed.headerBytes).toBeLessThan(packed.bytes.byteLength);
  });
});
