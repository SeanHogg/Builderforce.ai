import type { QuantizedTensor } from "./quant";
import type { WebDiTQuantization } from "./index";

/**
 * WebDiT weight-shard binary format. Single owner of the spec — converter
 * (write side: `packShard`) and runtime (read side: `parseBundleShard`)
 * both pull from here so they cannot drift.
 *
 * Layout:
 *   8 bytes:  little-endian uint64 header length
 *   N bytes:  JSON header { name: { dtype, shape, quantization, data: [s,e], scales: [s,e] } }
 *   M bytes:  raw concatenated tensor data + scales
 */

export interface PackedShard {
  bytes: Uint8Array;
  tensorNames: string[];
}

export interface ShardSummary {
  tensors: Map<string, QuantizedTensor>;
  /** Bytes consumed by the 8-byte length prefix + JSON header. */
  headerBytes: number;
  totalBytes: number;
}

interface ShardEntry {
  dtype: "uint8";
  shape: readonly number[];
  quantization: WebDiTQuantization;
  data: [number, number];
  scales: [number, number];
}

export function packShard(entries: Array<[string, QuantizedTensor]>): PackedShard {
  const header: Record<string, ShardEntry> = {};
  let offset = 0;
  const blobs: Uint8Array[] = [];

  for (const [name, t] of entries) {
    const dataStart = offset;
    const dataEnd = dataStart + t.data.byteLength;
    const scaleStart = dataEnd;
    const scaleEnd = scaleStart + t.scales.byteLength;
    header[name] = {
      dtype: "uint8",
      shape: t.shape,
      quantization: t.quantization,
      data: [dataStart, dataEnd],
      scales: [scaleStart, scaleEnd],
    };
    blobs.push(t.data);
    blobs.push(new Uint8Array(t.scales.buffer, t.scales.byteOffset, t.scales.byteLength));
    offset = scaleEnd;
  }

  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const totalDataLen = blobs.reduce((sum, b) => sum + b.byteLength, 0);
  const out = new Uint8Array(8 + headerBytes.byteLength + totalDataLen);
  new DataView(out.buffer).setBigUint64(0, BigInt(headerBytes.byteLength), true);
  out.set(headerBytes, 8);
  let cursor = 8 + headerBytes.byteLength;
  for (const b of blobs) {
    out.set(b, cursor);
    cursor += b.byteLength;
  }
  return { bytes: out, tensorNames: Object.keys(header) };
}

export function parseBundleShard(buf: Uint8Array): ShardSummary {
  if (buf.byteLength < 8) {
    throw new Error("shard: file shorter than 8-byte header length prefix");
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerLen = Number(view.getBigUint64(0, true));
  if (headerLen < 0 || 8 + headerLen > buf.byteLength) {
    throw new Error(`shard: declared header length ${headerLen} exceeds file size ${buf.byteLength}`);
  }
  const headerStr = new TextDecoder().decode(buf.subarray(8, 8 + headerLen));
  let header: Record<string, ShardEntry>;
  try {
    header = JSON.parse(headerStr) as Record<string, ShardEntry>;
  } catch (e) {
    throw new Error(`shard: header is not valid JSON: ${(e as Error).message}`);
  }
  const dataStart = 8 + headerLen;

  const tensors = new Map<string, QuantizedTensor>();
  for (const [name, entry] of Object.entries(header)) {
    const dataLo = dataStart + entry.data[0];
    const dataHi = dataStart + entry.data[1];
    const scaleLo = dataStart + entry.scales[0];
    const scaleHi = dataStart + entry.scales[1];
    if (dataHi > buf.byteLength || scaleHi > buf.byteLength) {
      throw new Error(`shard: tensor '${name}' offsets exceed file size`);
    }

    const data = copyOwned(buf.subarray(dataLo, dataHi));
    const scaleBytes = copyOwned(buf.subarray(scaleLo, scaleHi));
    if (scaleBytes.byteLength % 2 !== 0) {
      throw new Error(`shard: tensor '${name}' scale length not multiple of 2`);
    }
    const scales = new Uint16Array(scaleBytes.buffer, scaleBytes.byteOffset, scaleBytes.byteLength / 2);

    tensors.set(name, {
      data,
      scales,
      shape: entry.shape,
      quantization: entry.quantization,
    });
  }

  return {
    tensors,
    headerBytes: 8 + headerLen,
    totalBytes: buf.byteLength,
  };
}

function copyOwned(view: Uint8Array): Uint8Array {
  const owned = new Uint8Array(view.byteLength);
  owned.set(view);
  return owned;
}
