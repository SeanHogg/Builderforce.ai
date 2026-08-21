/**
 * Version history for a board that has NO SERVER — the half of "put this board back to
 * Tuesday" that a guest could not answer.
 *
 * ── WHAT ALREADY EXISTED ─────────────────────────────────────────────────────────
 * A saved canvas has real history: `creationSessionsApi.history` lists revisions,
 * `checkpoint` names one, and restoring replaces the graph. That covers the signed-in
 * case completely, and the history panel says so — by printing "history is only
 * available for saved sessions" to everybody else.
 *
 * ── WHY THAT WAS THE WRONG PLACE TO STOP ─────────────────────────────────────────
 * The guest board is the surface this product ACQUIRES on: a visitor lands, builds
 * something real, and is invited to keep it. It is also the surface with no undo beyond
 * the in-memory stack, no autosave beyond one overwriting snapshot, and — because it is
 * the surface most likely to be handed to an agent that rewrites half of it — the one
 * where "I want it back the way it was" is most likely to be said. Answering that with
 * "sign in first" is answering it after the work is gone.
 *
 * So a local board gets the same two verbs against the same panel: name a checkpoint,
 * restore one. The STORE is different because the constraints are (localStorage, a
 * quota, one device); the vocabulary is identical, which is what keeps the panel one
 * panel rather than two that drift.
 *
 * ── THE QUOTA IS THE INTERESTING PART ────────────────────────────────────────────
 * A real board serializes to megabytes, and `localStorage` throws when it is full — so
 * the naive version works until somebody has done enough work to care, then silently
 * stops saving at exactly that moment. Writes here therefore SHED: on a quota failure
 * the oldest checkpoint is dropped and the write retried, down to a single checkpoint,
 * and only then does it report failure. A history that keeps the newest three is worth
 * far more than one that kept twelve until the day it stopped.
 */

import type { Edge } from '@xyflow/react';
import type { CreationFlowNode } from '@/components/creation-canvas/CreationNode';
import { creationStorageKey } from '@/domains/canvas/infrastructure/localCanvasStore';

/**
 * How many checkpoints a local board keeps.
 *
 * Twelve rather than "all of them" for the reason above: this is a shared, hard-capped
 * store, and an unbounded list on one board is a board that stops the OTHER boards on
 * this device from saving at all. The oldest goes first — the recent past is what a
 * restore is for.
 */
export const LOCAL_CHECKPOINT_LIMIT = 12;

export interface LocalCheckpoint {
  id: string;
  label: string;
  /** ISO instant. What the panel prints and what the ordering is by. */
  at: string;
  nodes: CreationFlowNode[];
  edges: Edge[];
}

/** What the panel needs to LIST checkpoints, without deserializing every board in them. */
export interface LocalCheckpointSummary {
  id: string;
  label: string;
  at: string;
  /** Objects on the board when it was taken — the one fact that tells two checkpoints apart. */
  objectCount: number;
}

const checkpointsKey = (sessionId: string): string => `${creationStorageKey(sessionId)}:checkpoints`;

interface StoredCheckpoints {
  version: 1;
  checkpoints: LocalCheckpoint[];
}

/**
 * Read the stack, discarding anything that is not a checkpoint.
 *
 * Validated rather than trusted for the same reason `readLocalCreationSession` validates:
 * this is localStorage, which any earlier version of this app — or the person, through
 * devtools — may have written. A malformed entry must not take the panel down with it.
 */
export function readLocalCheckpoints(sessionId: string): LocalCheckpoint[] {
  try {
    const raw = localStorage.getItem(checkpointsKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredCheckpoints>;
    if (!Array.isArray(parsed.checkpoints)) return [];
    return parsed.checkpoints.filter((entry): entry is LocalCheckpoint =>
      !!entry && typeof entry === 'object'
      && typeof entry.id === 'string' && typeof entry.label === 'string' && typeof entry.at === 'string'
      && Array.isArray(entry.nodes) && Array.isArray(entry.edges));
  } catch {
    return [];
  }
}

/** The listing the panel renders. Newest first, because that is the one most often wanted. */
export function localCheckpointSummaries(sessionId: string): LocalCheckpointSummary[] {
  return readLocalCheckpoints(sessionId)
    .map((entry) => ({ id: entry.id, label: entry.label, at: entry.at, objectCount: entry.nodes.length }))
    .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
}

/**
 * The stack after adding one checkpoint — pure, so the trimming rule is testable without
 * a browser.
 *
 * Newest LAST in storage (append order), which is why the summary sorts on the way out
 * rather than the way in: an ordering applied at write time is one a corrupted or
 * hand-edited entry can violate, and the read path has to be robust anyway.
 */
export function withCheckpoint(
  existing: readonly LocalCheckpoint[],
  entry: LocalCheckpoint,
  limit = LOCAL_CHECKPOINT_LIMIT,
): LocalCheckpoint[] {
  const next = [...existing, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * Save a named checkpoint of the current board.
 *
 * Returns the stack that was actually stored, so a caller can render the truth rather
 * than what it hoped for — including the shorter stack a quota failure forced. Returns
 * `null` only when even ONE checkpoint would not fit, which is the honest signal that
 * this board cannot be checkpointed on this device at all.
 */
export function saveLocalCheckpoint(
  sessionId: string,
  label: string,
  board: { nodes: readonly CreationFlowNode[]; edges: readonly Edge[] },
  now: () => string = () => new Date().toISOString(),
): LocalCheckpointSummary[] | null {
  const entry: LocalCheckpoint = {
    id: crypto.randomUUID(),
    label: label.trim().slice(0, 120),
    at: now(),
    nodes: [...board.nodes],
    edges: [...board.edges],
  };
  let candidate = withCheckpoint(readLocalCheckpoints(sessionId), entry);
  // SHED AND RETRY. Down to one, because a store that keeps only the newest checkpoint
  // is still a store; one that refuses the write is not. See the header.
  while (candidate.length > 0) {
    try {
      localStorage.setItem(checkpointsKey(sessionId), JSON.stringify({ version: 1, checkpoints: candidate } satisfies StoredCheckpoints));
      return candidate
        .map((item) => ({ id: item.id, label: item.label, at: item.at, objectCount: item.nodes.length }))
        .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
    } catch {
      // Drop the OLDEST and try again. Dropping the newest would discard the one the
      // person just asked for, which is the only one they are certainly watching.
      candidate = candidate.slice(1);
    }
  }
  return null;
}

/** One checkpoint's board, or null when it is gone (another tab trimmed it, or it never existed). */
export function readLocalCheckpoint(sessionId: string, id: string): LocalCheckpoint | null {
  return readLocalCheckpoints(sessionId).find((entry) => entry.id === id) ?? null;
}
