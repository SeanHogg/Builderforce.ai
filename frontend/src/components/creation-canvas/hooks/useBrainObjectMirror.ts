/**
 * The Brain Object mirrors the live turn — messages, trace, and the run state that
 * drives its activity bar — so a working Brain reads as working on the board too,
 * not only inside the dock (which the user may have closed).
 *
 * The fields it writes are `BRAIN_MIRROR_FIELDS`; the history checkpoint ignores a
 * change confined to them, so the mirror never becomes an undo step.
 */
import { type Dispatch, type SetStateAction, useEffect } from 'react';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { brainMirrorData } from '@/lib/canvasBrainMirror';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasTimelineMessage } from '../canvasBoardTypes';

export interface UseBrainObjectMirrorDeps {
  brainRunStartedAt: number | null;
  brainTrace: BrainTraceEvent[];
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  thinking: boolean;
  timeline: CanvasTimelineMessage[];
}

export function useBrainObjectMirror({ brainRunStartedAt, brainTrace, setNodes, thinking, timeline }: UseBrainObjectMirrorDeps): void {
  useEffect(() => {
    setNodes((current) => current.map((node) => node.data.kind === 'chat'
      ? { ...node, data: { ...node.data, ...brainMirrorData({ timeline, trace: brainTrace, running: thinking, runStartedAt: brainRunStartedAt, priorAiResponse: node.data.aiResponse }) } }
      : node));
  }, [brainRunStartedAt, brainTrace, setNodes, thinking, timeline]);
}
