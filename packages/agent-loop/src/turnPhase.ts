/**
 * MID-TURN blocks — the visible text a run says on its way to an answer, marked as such
 * where it is persisted, so nothing downstream has to guess it from the wording.
 *
 * The Brain run commits each turn that says something before its tool calls as its own
 * durable assistant message (so the user keeps what they watched stream in). Those rows
 * went through the SAME persist path as the final answer, and the server's
 * learn-on-persist gate trained the project Evermind on every one of them: one IDE run
 * (2026-09-27, project #30) produced six head versions in ten minutes, each learned from
 * a "Let me check if X is imported:" block, and the held-out loss regressed.
 *
 * `stripRunNarration` reads narration off the TEXT, which is a heuristic and has to be.
 * This is the structural half: the writer KNOWS a block is mid-turn, so it says so in the
 * row's metadata, and the learn gate leaves such rows out of the batch entirely. The
 * final answer of the run — the one block that answers the task — is the only assistant
 * text a run contributes.
 */

/** The metadata key a mid-turn assistant row carries (`true`). */
export const MID_TURN_META_KEY = "midTurn";

/**
 * True when a persisted message is a mid-turn block. Accepts the metadata as the
 * JSON string the chat store keeps or as an already-parsed object; anything
 * unreadable is NOT mid-turn, so a malformed row is judged on its text as before.
 */
export function isMidTurnMetadata(metadata: unknown): boolean {
  let meta: unknown = metadata;
  if (typeof meta === "string") {
    if (!meta.includes(MID_TURN_META_KEY)) return false;
    try {
      meta = JSON.parse(meta);
    } catch {
      return false;
    }
  }
  return typeof meta === "object" && meta !== null && (meta as Record<string, unknown>)[MID_TURN_META_KEY] === true;
}
