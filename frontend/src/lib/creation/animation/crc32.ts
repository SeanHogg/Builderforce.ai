/**
 * CRC-32 (IEEE 802.3, polynomial 0xEDB88320) — the checksum PNG/APNG chunks carry.
 * `fflate` (the frontend's one codec) does not export its CRC, and the zip writer
 * needs none of its own, so the APNG encoder owns the only copy. The table is
 * built on first use.
 */

let TABLE: Uint32Array | null = null;

function table(): Uint32Array {
  if (TABLE) return TABLE;
  const built = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    built[n] = c >>> 0;
  }
  TABLE = built;
  return built;
}

export function crc32(bytes: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = (t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}
