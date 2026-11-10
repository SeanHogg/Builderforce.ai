/**
 * THE deterministic client entity id: a UUID-shaped id derived from a text key, so writing the same logical record twice
 * (here, or on another device) is one record. Every client entity id the sync envelope accepts is a UUID; this one is a
 * CUSTOM id (version nibble 8, variant bits set; NOT a UUIDv5): four seeded passes of the package's one FNV-1a
 * (`payloadHash.ts`), all a stable id needs (an identity, not a secret).
 *
 * Used by the chat-ticket link (`chatTicketLinkId`) and by any record keyed by a natural key (a run's outcome per
 * repository).
 */

import { fnv1a32 } from './payloadHash.js';

export function stableEntityId(key: string): string {
  const hex = [2166136261, 3339675911, 2654435761, 1013904223]
    .map((seed) => fnv1a32(key, seed).toString(16).padStart(8, '0'))
    .join('');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
