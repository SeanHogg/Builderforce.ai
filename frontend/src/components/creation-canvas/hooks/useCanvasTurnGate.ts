// No `'use client'`: this module exports hooks, not a component, so a directive marks no boundary.

/** The board's turn gate, how its failures are worded, and the no-model refusal's banner. */
import { type RefObject, useId, useMemo } from 'react';
import type { useTranslations } from 'next-intl';
import { useWebTurnGate } from '@/lib/localFirst/useWebInferenceMode';
import { useCanvasTurnErrors } from './useCanvasTurnErrors';
import type { CanvasModelRefusal } from '../brainTurn/modelRefusal';

/**
 * Everything a canvas turn passes on its way in and out: THE first-run gate (every canvas
 * turn passes it — the entry prompt included — and the ONE composer shows its question
 * through it), the composer's id (what the no-model banner's "Pick a model" / "Download
 * a local model" open the `/` menu of), and the failure wording + live refusals
 * (`useCanvasTurnErrors`).
 */
export function useCanvasTurnGate({ sessionId, t }: { sessionId: string; t: ReturnType<typeof useTranslations<'creationCanvas'>> }) {
  const errors = useCanvasTurnErrors({ sessionId, t });
  const { gate: modeGate } = useWebTurnGate();
  const composerId = useId();
  return { ...errors, modeGate, composerId };
}

/**
 * The last turn's no-model refusal as THE banner beside the conversation
 * (`brainTurn/modelRefusal.ts`) — what every Brain placement renders. "Switch to Hybrid"
 * moved the mode: the refused request is sent again through the board's one turn door
 * (`startCanvasTurnRef`, read at click time).
 */
export function useCanvasRefusalBanner({ modelRefusal, setModelRefusal, composerId, startCanvasTurnRef }: {
  modelRefusal: CanvasModelRefusal | null;
  setModelRefusal: (next: CanvasModelRefusal | null) => void;
  composerId: string;
  startCanvasTurnRef: RefObject<(text?: string) => void>;
}) {
  return useMemo(() => (modelRefusal ? {
    error: modelRefusal.message,
    action: modelRefusal.action,
    composerId,
    onDismiss: () => setModelRefusal(null),
    onRetry: () => startCanvasTurnRef.current?.(modelRefusal.request),
  } : null), [composerId, modelRefusal, setModelRefusal, startCanvasTurnRef]);
}
