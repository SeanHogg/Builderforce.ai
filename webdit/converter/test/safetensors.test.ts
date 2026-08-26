import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { parseSafetensors, readFileNoSizeLimit, readSafetensors } from "../src/safetensors";
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

describe("readFileNoSizeLimit / readSafetensors (file I/O)", () => {
  const tmpFiles: string[] = [];
  afterEach(async () => {
    await Promise.all(tmpFiles.splice(0).map((f) => fs.rm(f, { force: true })));
  });

  async function writeTmp(bytes: Uint8Array): Promise<string> {
    const p = path.join(os.tmpdir(), `webdit-safetensors-${Math.random().toString(36).slice(2)}.bin`);
    await fs.writeFile(p, bytes);
    tmpFiles.push(p);
    return p;
  }

  it("reads a file smaller than one chunk (single read() call)", async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const p = await writeTmp(data);
    const buf = await readFileNoSizeLimit(p, 1024);
    expect(Array.from(buf)).toEqual([1, 2, 3, 4, 5]);
  });

  it("reads a file spanning multiple chunks and reconstructs it byte-for-byte", async () => {
    // 10 chunks of 100 bytes each, deterministic content per chunk so a
    // misaligned/duplicated/dropped chunk would be caught.
    const data = new Uint8Array(1000);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const p = await writeTmp(data);
    // Real usage always uses the module's real default (CHUNK_BYTES); this
    // override just makes a ~1KB fixture exercise the same multi-chunk loop
    // that a real multi-GB safetensors file exercises with the real default.
    const buf = await readFileNoSizeLimit(p, 100);
    expect(buf.byteLength).toBe(1000);
    expect(Array.from(buf)).toEqual(Array.from(data));
  });

  it("reads a chunk size that doesn't evenly divide the file size", async () => {
    const data = new Uint8Array(950);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 256;
    const p = await writeTmp(data);
    const buf = await readFileNoSizeLimit(p, 100);
    expect(Array.from(buf)).toEqual(Array.from(data));
  });

  it("readSafetensors reads a real file from disk and parses it (regression: must not use the 2 GiB-limited fs.readFile)", async () => {
    const tensorData = new Float32Array([1, 2, -3, 4]);
    const bytes = new Uint8Array(tensorData.buffer);
    const header = { w: { dtype: "F32", shape: [2, 2], data_offsets: [0, bytes.byteLength] } };
    const headerJson = new TextEncoder().encode(JSON.stringify(header));
    const blob = new Uint8Array(8 + headerJson.byteLength + bytes.byteLength);
    new DataView(blob.buffer).setBigUint64(0, BigInt(headerJson.byteLength), true);
    blob.set(headerJson, 8);
    blob.set(bytes, 8 + headerJson.byteLength);

    const p = await writeTmp(blob);
    const [t] = await readSafetensors(p);
    expect(t!.name).toBe("w");
    expect(Array.from(t!.data)).toEqual([1, 2, -3, 4]);
  });
});
