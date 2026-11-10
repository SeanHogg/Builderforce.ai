/**
 * Which local chat a `ChatRef` names, and which server chat it is bound to, read inside a store
 * transaction (the write paths need the answer and the write to be one transaction's view).
 * The read path answers the same question from a snapshot (`chatClientIdOf` in `buildRail.ts`).
 */

import { parseSyncId, type EntityDestination, type LocalFirstTransaction, type SyncId } from "@builderforce/local-first";
import type { ChatRef } from "./railProtocol";

export interface ResolvedChat {
  clientId: string;
  /** The bound server chat id (its SyncId); undefined while the chat is only on this device. */
  serverId?: SyncId;
  destination: EntityDestination;
}

export async function resolveChat(tx: LocalFirstTransaction, ref: ChatRef): Promise<ResolvedChat | undefined> {
  if (typeof ref === "number") {
    const sync = parseSyncId(ref);
    if (sync === null) return undefined;
    const mapping = await tx.mappingByServerId("chat", sync);
    if (!mapping) return undefined;
    const chat = await tx.get("chat", mapping.clientEntityId);
    if (!chat || chat.deletedAt) return undefined;
    return { clientId: chat.id, serverId: sync, destination: mapping.destination };
  }
  const chat = await tx.get("chat", ref);
  if (!chat || chat.deletedAt) return undefined;
  const sync = parseSyncId((await tx.mapping("chat", chat.id, chat.destination))?.syncId);
  return { clientId: chat.id, ...(sync !== null ? { serverId: sync } : {}), destination: chat.destination };
}
