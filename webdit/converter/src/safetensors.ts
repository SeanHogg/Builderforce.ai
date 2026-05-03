import * as fs from "node:fs/promises";
import { bfloat16ToFloat, halfToFloat } from "./half";

export interface SafetensorsTensor {
  name: string;
  dtype: SafetensorsDtype;
  shape: number[];
  data: Float32Array;
}

export type SafetensorsDtype = "F32" | "F16" | "BF16";

interface RawTensorMeta {
  dtype: string;
  shape: number[];
  data_offsets: [number, number];
}

export async function readSafetensors(path: string): Promise<SafetensorsTensor[]> {
  const buf = await fs.readFile(path);
  return parseSafetensors(buf);
}

export function parseSafetensors(buf: Uint8Array): SafetensorsTensor[] {
  if (buf.byteLength < 8) throw new Error("safetensors: file shorter than 8-byte header");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerLen = Number(view.getBigUint64(0, true));
  if (headerLen + 8 > buf.byteLength) {
    throw new Error(`safetensors: declared header length ${headerLen} exceeds file size`);
  }
  const headerBytes = buf.subarray(8, 8 + headerLen);
  const headerStr = new TextDecoder().decode(headerBytes);
  const header = JSON.parse(headerStr) as Record<string, RawTensorMeta | { __metadata__: unknown }>;
  const dataStart = 8 + headerLen;

  const tensors: SafetensorsTensor[] = [];
  for (const [name, meta] of Object.entries(header)) {
    if (name === "__metadata__") continue;
    const m = meta as RawTensorMeta;
    const start = dataStart + m.data_offsets[0];
    const end = dataStart + m.data_offsets[1];
    const slice = buf.subarray(start, end);
    tensors.push({
      name,
      dtype: assertDtype(m.dtype),
      shape: m.shape,
      data: decodeTensor(slice, m.dtype),
    });
  }
  return tensors;
}

function assertDtype(d: string): SafetensorsDtype {
  if (d === "F32" || d === "F16" || d === "BF16") return d;
  throw new Error(`safetensors: unsupported dtype ${d}`);
}

function decodeTensor(buf: Uint8Array, dtype: string): Float32Array {
  if (dtype === "F32") {
    if (buf.byteLength % 4 !== 0) throw new Error("safetensors: F32 length not multiple of 4");
    const aligned = new Uint8Array(buf);
    return new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4);
  }
  if (buf.byteLength % 2 !== 0) {
    throw new Error(`safetensors: ${dtype} length not multiple of 2`);
  }
  const aligned = new Uint8Array(buf);
  const u16 = new Uint16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 2);
  const out = new Float32Array(u16.length);
  const decode = dtype === "F16" ? halfToFloat : bfloat16ToFloat;
  for (let i = 0; i < u16.length; i++) out[i] = decode(u16[i]!);
  return out;
}
