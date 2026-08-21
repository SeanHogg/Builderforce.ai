/**
 * PERSIST CANVAS — the board reaching durable storage, and what the person is
 * told about it.
 *
 * ── WHY IT IS A USE CASE AND NOT AN EFFECT ───────────────────────────────────
 * PRD 22 §3.4 names `persistSnapshot` and `noteSaveState` as belonging here.
 * What was actually in `CanvasInner` was larger than those two names: a 60-line
 * `useEffect` that decided whether the board had changed, chose between two
 * completely different storage strategies, translated the board for the wire,
 * minted an idempotency key, interpreted a conflict error, RE-READ the session,
 * merged two boards and then set six pieces of React state — with every branch
 * reachable only by mounting the canvas.
 *
 * Three rules were buried in it and all three are load-bearing:
 *
 *   1. THE SIGNATURE. "Has the board changed" was `JSON.stringify({nodes,edges})`
 *      written at four call sites. Any one of them drifting turns autosave into
 *      either a no-op or a write on every render.
 *   2. THE CONFLICT MERGE. `Session changed` is not an error — it is a
 *      collaborator having saved first — and the recovery re-reads, merges LOCAL
 *      LAST and keeps going. Treated as a failure it becomes "Save failed" on a
 *      board that is fine.
 *   3. THE IDEMPOTENCY KEY, which must be STABLE across retries of the same
 *      board and NEW for a different one. Regenerating it per attempt makes a
 *      retried save a second write.
 *
 * ── THE NOTICE RULE, WHICH IS SEPARATE AND ALSO REAL ─────────────────────────
 * One status line, two kinds of message competing for it: an OUTCOME ("Sketch
 * added") and a routine SAVE STATE ("Saving…"). Autosave is debounced 300ms
 * behind the edit that triggered it, so every outcome used to be wiped by a save
 * confirmation a third of a second later — too fast to read, and the one message
 * the person was waiting for. {@link createCanvasNotices} owns that arbitration
 * so the two callbacks cannot be called in the wrong order by a new call site.
 */

import {
  boardFromPersistedGraph,
  mergeCollaboratorBoards,
  persistedGraphFromBoard,
  type CanvasBoard,
  type PersistableCanvasGraph,
  type PersistedCanvasGraph,
  type RejectedCanvasObject,
} from '../domain/canvasBoard';
import type { CanvasTextTranslator } from '../domain/canvasText';

/** How long an outcome holds the status line against routine save chatter. */
export const OUTCOME_HOLD_MS = 4_000;

/**
 * The status line, with the outcome-vs-save-state rule inside it.
 *
 * Takes the publisher rather than returning text, because the rule is about
 * WHETHER to speak at all — a caller handed a `string | null` would have to
 * re-implement "and if null, leave the previous message alone", which is the
 * duplication this replaces.
 */
export interface CanvasNotices {
  /** Something the user did just landed. Always shown, and holds the line. */
  outcome(text: string): void;
  /** Routine save chatter. Shown only if no outcome is still holding the line. */
  saveState(text: string): void;
}

export function createCanvasNotices(
  publish: (text: string) => void,
  { holdMs = OUTCOME_HOLD_MS, now = () => Date.now() }: { holdMs?: number; now?: () => number } = {},
): CanvasNotices {
  let lastOutcomeAt = 0;
  return {
    outcome(text) {
      lastOutcomeAt = now();
      publish(text);
    },
    saveState(text) {
      // A save that stays quiet is not a save that did not happen: the outcome
      // already told the person their change landed, and the next edit's save
      // says so again once the outcome has had its moment.
      if (now() - lastOutcomeAt < holdMs) return;
      publish(text);
    },
  };
}

/**
 * What the board IS, as one comparable value.
 *
 * The ONE definition. Two call sites disagreeing about whether the viewport is
 * part of the signature is the difference between a board that autosaves on
 * every pan and one that never autosaves at all — and both were plausible
 * readings of four hand-written `JSON.stringify` calls.
 *
 * The viewport is deliberately OUT: panning is not an edit, and a save per pan
 * frame is a revision per pan frame.
 */
export function boardSignature(board: CanvasBoard): string {
  return JSON.stringify({ nodes: board.nodes, edges: board.edges });
}

/**
 * How this canvas reaches the server. Narrow on purpose — a use case that can
 * see the whole `creationSessionsApi` will eventually call something else on it.
 */
export interface CanvasSessionPort {
  /** Replace the stored graph. Rejects with `Session changed` on a stale revision. */
  replaceGraph(input: {
    sessionId: string;
    expectedRevision: number;
    idempotencyKey: string;
    graph: PersistableCanvasGraph;
  }): Promise<{ revision: number }>;
  /** Re-read the session, for the conflict path. */
  read(sessionId: string): Promise<{ graph: PersistedCanvasGraph; revision: number }>;
}

/** The error the server raises when someone else saved first. Not a failure. */
export const SESSION_CHANGED = 'Session changed';

/**
 * What a save produced, as a description the surface applies.
 *
 * `merged` carries a whole board because the conflict path legitimately changes
 * what is on screen; `saved` carries none because the board the caller already
 * holds is correct. Making them one shape with an optional board would let a
 * caller forget which case it is in, and the case it would forget is the one
 * that silently discards a collaborator's work.
 */
export type PersistResult =
  | { outcome: 'saved'; revision: number; signature: string; objectIds: string[] }
  | { outcome: 'merged'; revision: number; signature: string; objectIds: string[]; board: CanvasBoard; rejected: RejectedCanvasObject[]; notice: string }
  | { outcome: 'failed'; notice: string };

/**
 * The idempotency key for a save attempt.
 *
 * STABLE for the same board, NEW for a different one — so a retry after a
 * timeout is the same write and an edit made during that timeout is not. The
 * caller keeps the last one; this decides whether it still applies.
 */
export function saveAttemptKey(
  previous: { signature: string; key: string } | null,
  signature: string,
): { signature: string; key: string } {
  return previous && previous.signature === signature ? previous : { signature, key: crypto.randomUUID() };
}

export interface PersistBoardInput {
  sessionId: string;
  board: CanvasBoard;
  viewport?: { x: number; y: number; zoom: number };
  expectedRevision: number;
  idempotencyKey: string;
  /** The signature that was current when this attempt started. */
  signature: string;
}

/**
 * Write the board, and interpret what comes back.
 *
 * The whole conflict recovery lives here rather than in a `.catch` inside a
 * component: it is the one piece of canvas persistence with a genuinely
 * interesting rule (LOCAL LAST, enforced by `mergeCollaboratorBoards`), and it
 * was the piece with no test.
 */
export async function persistBoard(
  { sessionId, board, viewport, expectedRevision, idempotencyKey, signature }: PersistBoardInput,
  sessions: CanvasSessionPort,
  t: CanvasTextTranslator,
): Promise<PersistResult> {
  const graph = persistedGraphFromBoard({ ...board, ...(viewport ? { viewport } : {}) });
  try {
    const saved = await sessions.replaceGraph({ sessionId, expectedRevision, idempotencyKey, graph });
    return { outcome: 'saved', revision: saved.revision, signature, objectIds: graph.objects.map((object) => object.id) };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== SESSION_CHANGED) {
      return { outcome: 'failed', notice: error instanceof Error ? error.message : t('noticeSaveFailed') };
    }
    try {
      const latest = await sessions.read(sessionId);
      const { board: remote, rejected } = boardFromPersistedGraph(latest.graph);
      return {
        outcome: 'merged',
        revision: latest.revision,
        // The REMOTE board is now what the server holds, so that is what the next
        // "has it changed" comparison must be made against. Signing the merged
        // board instead would mark a board that has never been written as saved.
        signature: boardSignature(remote),
        objectIds: remote.nodes.map((node) => node.id),
        board: mergeCollaboratorBoards(board, remote),
        rejected,
        notice: t('noticeConcurrentMerged'),
      };
    } catch {
      // The re-read failed too: say the original thing rather than inventing a
      // second error about a recovery the user never asked for.
      return { outcome: 'failed', notice: t('noticeSaveConflict') };
    }
  }
}
