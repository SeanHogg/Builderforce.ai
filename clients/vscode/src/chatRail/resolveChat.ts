/**
 * Which local chat a `ChatRef` names, and which server chat it is bound to, read inside a store
 * transaction (the write paths need the answer and the write to be one transaction's view).
 * The read path answers the same question from a snapshot (`chatClientIdOf` in `buildRail.ts`).
 */

import type { EntityDestination, LocalFirstTransaction } from "@builderforce/local-first";
import type { ChatRef } from "./railProtocol";

export interface ResolvedChat {
  clientId: string;
  /** The bound server chat id; undefined while the chat is only on this device. */
  serverId?: number;
  destination: EntityDestination;
}

function asServerId(value: string | undefined): number | undefined {
  const id = value === undefined ? NaN : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export async function resolveChat(tx: LocalFirstTransaction, ref: ChatRef): Promise<ResolvedChat | undefined> {
  if (typeof ref === "number") {
    const mapping = await tx.mappingByServerId("chat", String(ref));
    if (!mapping) return undefined;
    const chat = await tx.get("chat", mapping.clientEntityId);
    if (!chat || chat.deletedAt) return undefined;
    return { clientId: chat.id, serverId: ref, destination: mapping.destination };
  }
  const chat = await tx.get("chat", ref);
  if (!chat || chat.deletedAt) return undefined;
  const mapping = await tx.mapping("chat", chat.id, chat.destination);
  return { clientId: chat.id, serverId: asServerId(mapping?.serverId), destination: chat.destination };
}
