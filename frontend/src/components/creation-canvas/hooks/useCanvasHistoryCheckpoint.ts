/**
 * The board's history checkpoint: every settled board change becomes one undo step
 * and one journal row.
 *
 * Every board mutation — palette, drag, delete, inspector edit, an AI proposal being
 * applied, an undo — settles HERE, so this is the one place that can record what the
 * person did without a dozen handlers each remembering to. See `describeGraphChange`.
 *
 * A change confined to the Brain object's live-turn mirror (`withoutBrainMirror`) is
 * NOT a step: the baseline moves silently, so a later undo snapshot still carries the
 * current transcript, but the Brain's trace never lands on the undo stack or in the
 * journal as a person's edit.
 */
import { type RefObject, useEffect } from 'react';
import type { Edge } from '@xyflow/react';
import { type CanvasJournal, describeGraphChange } from '@/lib/canvasActionJournal';
import { withoutBrainMirror } from '@/lib/canvasBrainMirror';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';

export interface UseCanvasHistoryCheckpointDeps {
  edges: Edge[];
  historyApplyingRef: RefObject<boolean>;
  historyBaselineRef: RefObject<string | null>;
  hydratedRef: RefObject<boolean>;
  journalRef: RefObject<CanvasJournal>;
  nodes: CanvasObject[];
  redoStackRef: RefObject<string[]>;
  undoStackRef: RefObject<string[]>;
}

/** Bounded undo depth; the oldest step is dropped first. */
const UNDO_LIMIT = 50;

/** Board changes settle for this long before they become one step. */
const CHECKPOINT_SETTLE_MS = 500;

export function useCanvasHistoryCheckpoint({ edges, historyApplyingRef, historyBaselineRef, hydratedRef, journalRef, nodes, redoStackRef, undoStackRef }: UseCanvasHistoryCheckpointDeps): void {
  useEffect(() => {
    if (!hydratedRef.current || historyApplyingRef.current) return;
    const next = JSON.stringify({ nodes, edges });
    const handle = window.setTimeout(() => {
      const baseline = historyBaselineRef.current;
      if (baseline == null) { historyBaselineRef.current = next; return; }
      if (baseline === next) return;
      // An unreadable baseline is still a step: the catch falls through to the push below.
      try {
        const before = JSON.parse(baseline) as { nodes: CanvasObject[]; edges: Edge[] };
        if (JSON.stringify(withoutBrainMirror(before)) === JSON.stringify(withoutBrainMirror({ nodes, edges }))) {
          historyBaselineRef.current = next;
          return;
        }
        const change = describeGraphChange(before, { nodes, edges });
        if (change) journalRef.current.record({ kind: 'user', label: change.label, detail: change.detail });
      } catch { /* the journal must never be able to break the history stack */ }
      undoStackRef.current = [...undoStackRef.current.slice(-(UNDO_LIMIT - 1)), baseline];
      historyBaselineRef.current = next;
      redoStackRef.current = [];
    }, CHECKPOINT_SETTLE_MS);
    return () => window.clearTimeout(handle);
  }, [edges, historyApplyingRef, historyBaselineRef, hydratedRef, journalRef, nodes, redoStackRef, undoStackRef]);
}
