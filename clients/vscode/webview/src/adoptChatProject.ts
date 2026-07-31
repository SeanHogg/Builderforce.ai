import type { BrainChat } from '@seanhogg/builderforce-brain-embedded';

/**
 * Bind the IDE's active project onto a project-LESS chat.
 *
 * The server's chat→Evermind learn gate keys on `brain_chats.project_id`
 * (`evaluateBrainLearnGate`): a chat with none contributes NOTHING, while the panel
 * still shows the project's model as "connected" — because the panel resolves its
 * project from the IDE selection, not from the chat. The result is a chat that reports
 * "Learning · Connected" and silently trains nothing, every turn.
 *
 * Extracted from `App.tsx` so the rule is testable without mounting the webview, and
 * because the version that lived inline had a defect this signature makes hard to
 * repeat: it decided from the component's `chats` array, which is fetched with
 * `?projectId=<active>` and filtered SERVER-side as `project_id = <active>`. A
 * project-less chat is therefore never in it, so the lookup missed, the effect bailed,
 * and the self-heal could not fire for the one case it existed for. The chat's project
 * must be read from the CHAT (`getChat`), never inferred from a project-scoped list.
 */
export interface AdoptChatProjectDeps {
  getChat(id: number): Promise<BrainChat>;
  updateChat(id: number, body: { projectId: number }): Promise<BrainChat>;
}

export type AdoptOutcome =
  /** Bound the project onto the chat. */
  | 'adopted'
  /** The chat already had a project — left as-is (never re-pointed). */
  | 'already-scoped'
  /** No active project to adopt, or no chat open. */
  | 'no-project'
  /** The read or write failed; the caller should allow a retry. */
  | 'failed';

/**
 * Adopt `projectId` onto `chatId` when — and only when — the chat has no project.
 *
 * Never re-points a chat that is deliberately scoped elsewhere, and never invents a
 * project when the IDE has none selected. Returns the outcome so the caller can decide
 * whether to reload its list ('adopted') or release its one-shot guard ('failed').
 */
export async function adoptChatProject(
  deps: AdoptChatProjectDeps,
  chatId: number | null | undefined,
  projectId: number | null | undefined,
): Promise<AdoptOutcome> {
  if (chatId == null || projectId == null) return 'no-project';
  try {
    const chat = await deps.getChat(chatId);
    if (chat.projectId != null) return 'already-scoped';
    await deps.updateChat(chatId, { projectId });
    return 'adopted';
  } catch {
    return 'failed';
  }
}
