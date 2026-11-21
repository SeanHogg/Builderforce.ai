/**
 * INJECTED user turns — a `role: 'user'` row the person did not write: the editor's Resume continuation
 * (`clients/vscode/src/interruptedResumeTurn.ts`), which quotes the interrupted run's ask and its sub-agents'
 * briefs verbatim. It is persisted (the chat shows what was sent) with `{ injected: true }` in its metadata,
 * and the run carries the persisted ids of such rows (`BrainRunRequest.injectedTurnIds`), so it is never marked
 * a PERSON turn (`runStore/chatAsks.ts`): it can neither set nor lift the chat's publish hold
 * (`runStore/publishHold.ts`) nor become one of the chat's asks. VS Code chat #157440: a resumed sub-agent brief
 * ending "Do not commit." set the hold on the person's chat.
 *
 * A leaf (no imports) so the send path, the seed builder and the run share ONE spelling.
 */

/** The metadata key that marks a persisted user row as injected, not the person's words. */
export const INJECTED_TURN_META_KEY = 'injected';

/** Merge the injected mark into a row's metadata object. */
export function withInjectedMeta(base?: Record<string, unknown>): Record<string, unknown> {
  return { ...(base ?? {}), [INJECTED_TURN_META_KEY]: true };
}

/** The persisted ids of the injected user rows in a chat's history — what a run request carries as `injectedTurnIds`. */
export function injectedTurnIdsOf(history: ReadonlyArray<{ id: number; role: string; metadata?: string | null }>): number[] {
  return history.filter((m) => m.role === 'user' && isInjectedTurnMetadata(m.metadata)).map((m) => m.id);
}

/** Is this persisted row's metadata (its JSON string, or the parsed object) marked injected? */
export function isInjectedTurnMetadata(metadata: unknown): boolean {
  let meta = metadata;
  if (typeof meta === 'string') {
    if (!meta.includes(INJECTED_TURN_META_KEY)) return false;
    try {
      meta = JSON.parse(meta) as unknown;
    } catch {
      return false;
    }
  }
  return typeof meta === 'object' && meta !== null && (meta as Record<string, unknown>)[INJECTED_TURN_META_KEY] === true;
}
