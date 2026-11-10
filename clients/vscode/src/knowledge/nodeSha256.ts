/**
 * The editor's content hash for the directory source and the pool worker: memory's `contentHash`
 * (PRD 41 §B2 step 0, rule `CONTENT_HASH_RULE`) computed with native SHA-256. Memory's hasher is
 * pure TypeScript (about 100 ms for a 2 MB file against about 4 ms natively), so the editor applies
 * the SAME normalization and hashes natively: CRLF and lone CR become LF when the bytes are text,
 * binary bytes are hashed raw. `nodeSha256.test.ts` proves the digest equals `contentHash`.
 */

import { createHash } from "node:crypto";

const CR = 0x0d;
const LF = 0x0a;
const LF_BYTES = new Uint8Array([LF]);
/** Memory's binary rule (`isBinaryBytes`, not exported): a NUL among the first 8192 bytes. Pinned by the parity test. */
const BINARY_SNIFF_BYTES = 8192;

export function nodeContentHash(bytes: Uint8Array): string {
  const hash = createHash("sha256");
  let cr = bytes.indexOf(CR);
  // No CR: the normalized bytes ARE the bytes (text or binary).
  if (cr < 0 || bytes.subarray(0, BINARY_SNIFF_BYTES).indexOf(0) >= 0) return hash.update(bytes).digest("hex");
  let start = 0;
  while (cr >= 0) {
    hash.update(bytes.subarray(start, cr)).update(LF_BYTES);
    start = bytes[cr + 1] === LF ? cr + 2 : cr + 1;
    cr = bytes.indexOf(CR, start);
  }
  return hash.update(bytes.subarray(start)).digest("hex");
}
