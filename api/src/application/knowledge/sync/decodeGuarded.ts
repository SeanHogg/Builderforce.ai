/**
 * decodeGuarded — the shared codec behind every sync entry point, with its failures mapped to the
 * errors the routes answer (PRD 41 A11 rule 4): past 64 MB inflated is `413 pack_too_large`, a malformed
 * frame or a failed CRC is `422 bad_pack`. The caps are the codec's own, enforced before any row is built.
 */
import { decodePack, PackFormatError, PackTooLargeError, type Pack } from '@seanhogg/builderforce-memory/knowledge/pack';
import { KnowledgeSyncError, MAX_SYNC_BODY_BYTES } from './knowledgeSyncPorts';

export async function decodeGuarded(bytes: Uint8Array): Promise<Pack> {
  if (bytes.length > MAX_SYNC_BODY_BYTES * 64) throw new KnowledgeSyncError(413, 'pack_too_large', 'the pack is too large');
  try {
    return await decodePack(bytes);
  } catch (error) {
    if (error instanceof PackTooLargeError) throw new KnowledgeSyncError(413, 'pack_too_large', `the pack inflates past ${error.limit} bytes`);
    if (error instanceof PackFormatError) throw new KnowledgeSyncError(422, 'bad_pack', error.message);
    throw error;
  }
}
