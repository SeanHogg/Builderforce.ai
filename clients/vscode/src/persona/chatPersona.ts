/**
 * A chat's methodology role state (PRD 49 §1.8) — the ONLY reader and writer of the
 * `persona` field on the local chat record behind `BrainPersistenceAdapter`. No second
 * store, no workspace setting, no global: the state belongs to the conversation.
 */
import { chatPersonaOf, type ChatPersonaState } from "@builderforce/agent-tools";
import type { BrainPersistenceAdapter } from "@seanhogg/builderforce-brain-embedded";

/** The two adapter calls this module needs (the host passes its local persistence). */
export type ChatPersonaRecords = Pick<BrainPersistenceAdapter, "getChat" | "updateChat">;

/** The chat's state; a record with no `persona` field loads as role off. */
export async function loadChatPersona(records: ChatPersonaRecords, chatId: number): Promise<ChatPersonaState> {
  return chatPersonaOf(await records.getChat(chatId));
}

export async function saveChatPersona(records: ChatPersonaRecords, chatId: number, state: ChatPersonaState): Promise<void> {
  await records.updateChat(chatId, { persona: state });
}
