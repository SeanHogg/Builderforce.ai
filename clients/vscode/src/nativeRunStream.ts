/**
 * What the native chat participant needs around the shared loop's run cell: turning its
 * observable state into the linear markdown stream the native chat renders, spotting a run
 * the loop stopped itself, and the transient persistence the participant uses because it
 * writes the whole turn once, after the loop. Split from `nativeBrainRun.ts`, which re-exports
 * every name here. No `vscode` import.
 */

import { isForcedFinishStep, type BrainRunPersistence, type BrainRunSnapshot, type BrainTraceEvent } from "@seanhogg/builderforce-brain-embedded";
import type { NativeRunEvents } from "./nativeRunTypes";

/**
 * Turn the run store's observable state into the linear markdown stream the native
 * chat renders.
 *
 * Two sources have to be reconciled without ever printing the same sentence twice.
 * `streamingText` is the live buffer the user watches fill; `appended` is what the loop
 * durably committed. Normally the second is the settled form of the first, so a
 * committed message whose text was already streamed is skipped — but a MEMORY-FIRST
 * answer never streams at all (that is the whole point: no model call), so it arrives
 * only as an appended message and must be printed. Tracking both is what makes the two
 * cases one code path.
 */
export function createStreamRelay(events: Pick<NativeRunEvents, "onText">): (snapshot: BrainRunSnapshot) => void {
  let lastStreaming = "";
  const seenIds = new Set<number>();
  const alreadyShown = new Set<string>();
  return (snapshot) => {
    const text = snapshot.streamingText;
    if (text !== lastStreaming) {
      if (text.startsWith(lastStreaming)) {
        const delta = text.slice(lastStreaming.length);
        if (delta) events.onText(delta);
      } else {
        // The turn ended (buffer cleared) or restarted with different content. Whatever
        // was on screen is now settled — remember it so its committed twin is not
        // reprinted below.
        if (lastStreaming.trim()) alreadyShown.add(lastStreaming.trim());
        if (text) events.onText(text);
      }
      lastStreaming = text;
    }
    for (const message of snapshot.appended) {
      if (!message || seenIds.has(message.id)) continue;
      seenIds.add(message.id);
      const content = typeof message.content === "string" ? message.content.trim() : "";
      if (!content) continue;
      // Committed while still on screen, or already settled — the user has read it.
      if (content === lastStreaming.trim() || alreadyShown.has(content)) {
        alreadyShown.add(content);
        continue;
      }
      alreadyShown.add(content);
      events.onText(`\n\n${content}\n`);
    }
  };
}

/**
 * Did the loop stop the run itself? A run has no step ceiling; the only limit is the
 * consecutive-tool-failure breaker, after which the loop forces a final answer with
 * tools withdrawn (or, if that too is empty, records a loop error). True on either. The
 * native surface appends a dispatch hint on that outcome — the failures are named in
 * the turn, and a cloud agent can carry the work on in its own runtime.
 */
export function exhaustedToolBudget(events: readonly BrainTraceEvent[]): boolean {
  return events.some(
    (e) =>
      isForcedFinishStep(e) ||
      (e.category === "error" && e.label === "agent.loop"),
  );
}

/**
 * The loop persists every intermediate turn through this port. The native participant
 * writes the WHOLE exchange ONCE after the run (that single write is also what triggers
 * the server-side Evermind learn gate), so the in-run writes must not reach the server
 * or the conversation would be stored twice. Ids are negative: nothing downstream can
 * mistake one for a real `brain_messages` row. UNIQUE PER PROCESS (one counter for every port): a chat's run cell keeps its
 * persisted rows across turns, and a row id is how a run tells its own rows from an earlier turn's (`settledAnswerOf`) — a
 * counter that restarted with each turn's port would hand turn 2 the ids turn 1 already used.
 */
let nextTransientId = -1;

export function transientRunPersistence(): BrainRunPersistence {
  return {
    async sendMessages(_chatId, messages) {
      const at = new Date().toISOString();
      return messages.map((m) => ({
        id: nextTransientId--,
        role: m.role,
        content: m.content,
        metadata: m.metadata ?? null,
        seq: 0,
        createdAt: at,
      }));
    },
  };
}
