/**
 * decodeGuarded — the shared codec behind every sync entry point, with its failures mapped to the
 * errors the routes answer (PRD 41 A11 rule 4): past the codec's decoded cap (24 MB, sized for a 128 MB Worker) is
 * `413 pack_too_large`, a malformed frame or a failed CRC is `422 bad_pack`. The caps are the codec's own, enforced
 * before any row is built. A pack is passed whole or as its ordered parts; parts are inflated as ONE stream, never joined.
 */
import { decodePack, PackFormatError, PackTooLargeError, peekPack, type Pack } from '@seanhogg/builderforce-memory/knowledge/pack';
import { KnowledgeSyncError, MAX_PACK_BYTES } from './knowledgeSyncPorts';

const refuse = (error: unknown): never => {
  if (error instanceof PackTooLargeError) throw new KnowledgeSyncError(413, 'pack_too_large', `the pack inflates past ${error.limit} bytes`);
  if (error instanceof PackFormatError) throw new KnowledgeSyncError(422, 'bad_pack', error.message);
  throw error;
};

type PackBytes = Uint8Array | readonly Uint8Array[];
const sizeOf = (bytes: PackBytes): number => (bytes instanceof Uint8Array ? bytes.length : bytes.reduce((n, p) => n + p.length, 0));

export async function decodeGuarded(bytes: PackBytes): Promise<Pack> {
  if (sizeOf(bytes) > MAX_PACK_BYTES) throw new KnowledgeSyncError(413, 'pack_too_large', 'the pack is too large');
  try {
    return await decodePack(bytes);
  } catch (error) {
    return refuse(error);
  }
}

/** The frame's root, generation and digest without inflating the body: the generation is checked before any decompression. */
export function peekGuarded(bytes: PackBytes): ReturnType<typeof peekPack> {
  try {
    return peekPack(bytes);
  } catch (error) {
    return refuse(error);
  }
}
