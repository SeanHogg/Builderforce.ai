'use client';

import { useEffect, useMemo } from 'react';
import { assessmentGate, liveAssessmentMode, type AssessmentGate } from '@/lib/academic/assessment';
import { canvasProjectId, canvasProjectNodes } from '@/lib/canvasProjectRef';
import { useClock } from '@/lib/useClock';
import type { CreationNodeData } from '@/components/creation-canvas/types';
import { useOptionalActiveCanvas } from './ActiveCanvasContext';

/**
 * How often the board re-asks which assessments are live. A release time or a
 * deadline passes without anyone editing the board, and a closed-book exam that
 * only locks the assistant on the next edit has already been sat with it.
 */
const ASSESSMENT_CLOCK_MS = 30_000;

/**
 * WHAT A BOARD TELLS THE SHELL about itself, published from one place.
 *
 *   • the canonical projects it references — read by the stage to decide whether
 *     to show "viewing a canvas outside the current project" after a scope change,
 *     per `canvasScopePolicy`;
 *   • the strictest assessment being SAT on it right now — read by every composer
 *     in the shell through `useAssistantGate`, so a closed-book exam closes the
 *     floating Brain as well as the canvas prompt.
 *
 * Returns the board's OWN gate too, for the turns the board starts without a
 * composer (per-object actions, replays), which must refuse exactly as the
 * composer does.
 */
export function usePublishBoardToShell(
  sessionId: string,
  nodes: readonly { id: string; data: CreationNodeData }[],
): AssessmentGate {
  const activeCanvas = useOptionalActiveCanvas();
  const publishProjectIds = activeCanvas?.publishProjectIds;
  const publishAssessmentMode = activeCanvas?.publishAssessmentMode;

  const boardProjectIds = useMemo(
    () => [...new Set(canvasProjectNodes(nodes).flatMap((node) => { const id = canvasProjectId(node.data); return id == null ? [] : [id]; }))],
    [nodes],
  );
  useEffect(() => {
    publishProjectIds?.(sessionId, boardProjectIds);
  }, [boardProjectIds, publishProjectIds, sessionId]);

  const now = useClock(ASSESSMENT_CLOCK_MS);
  const mode = useMemo(
    () => liveAssessmentMode(nodes.map((node) => node.data as unknown as Record<string, unknown>), now),
    [nodes, now],
  );
  useEffect(() => {
    publishAssessmentMode?.(sessionId, mode);
  }, [mode, publishAssessmentMode, sessionId]);

  return useMemo(() => assessmentGate(mode), [mode]);
}
