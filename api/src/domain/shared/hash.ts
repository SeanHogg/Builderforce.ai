/**
 * SHA-256 as lowercase hex — the ONE implementation.
 *
 * This function was written four times, byte for byte, differing only in whether
 * the author spelled the spread `[...new Uint8Array(d)]` or `Array.from(...)`:
 * `creationSessionRoutes.ts` (invitation tokens), `ObjectRegistry.ts` (share
 * links), `feedbackSpec.ts` (duplicate-collapse keys) and `errorSpec.ts` (error
 * grouping fingerprints). Two of those four are security boundaries — the stored
 * hash is what makes a leaked database row unable to mint a working link — and a
 * security primitive with four copies has four places to get it wrong.
 *
 * Pure and dependency-free, so it belongs in `domain/shared` beside the other
 * value helpers rather than in any one feature that happens to need a digest.
 *
 * `crypto.subtle` is available in Workers, Node 18+ and the test runner alike, so
 * there is no platform branch to hide here.
 */
import { sha256HexBytes } from '@builderforce/read-through-cache';

export async function sha256Hex(value: string): Promise<string> {
  return sha256HexBytes(new TextEncoder().encode(value));
}

/** Same digest, for callers who already have bytes (a file upload) rather than
 *  a string — encoding binary data as text first would corrupt it.
 *
 *  The digest itself lives in `@builderforce/read-through-cache`, which needs it
 *  for its 512-byte KV key hashing and cannot import api code; re-exported here
 *  so the api keeps ONE implementation rather than a fifth copy. */
export { sha256HexBytes };
