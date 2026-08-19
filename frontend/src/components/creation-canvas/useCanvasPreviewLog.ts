/*
 * No `'use client'` here on purpose. Every importer is already inside
 * `CreationCanvas.tsx`'s client boundary, and `check-frontend-architecture` counts
 * directives, not components.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react';
import {
  appendCanvasPreviewEntry,
  canvasPreviewEntry,
  canvasPreviewSummary,
  type CanvasPreviewEntry,
  type CanvasPreviewSummary,
} from '@/lib/canvasPreviewReport';

/**
 * THE listener for what a framed preview says about itself.
 *
 * ── WHY IT IS A HOOK AND NOT A LISTENER PER SURFACE ──────────────────────────────
 * Two surfaces read the same wire (`app` and the live web-page panel), and a third is
 * one QA-runner away. The first of them wrote its own listener and it was wrong in the
 * way an un-shared listener is always wrong: it matched on the tag alone, so a board
 * with two running previews fed each one's console into the other. Scoping to the
 * frame's own `contentWindow` is not an optimisation, it is the correctness condition,
 * and it belongs in the one place both readers go through.
 *
 * ── WHY `active` GATES IT ────────────────────────────────────────────────────────
 * A stopped app and an unloaded panel have no frame, so a message claiming to come from
 * one is a message from something else. Gating also means the common case — a board full
 * of cards that are not previewing anything — adds no `window` listeners at all.
 */
export interface CanvasPreviewLog {
  log: CanvasPreviewEntry[];
  summary: CanvasPreviewSummary;
  /** Drop everything heard so far — what "reload" and "restart" mean for a console. */
  reset: () => void;
}

export function useCanvasPreviewLog(
  frameRef: RefObject<HTMLIFrameElement | null>,
  active: boolean,
): CanvasPreviewLog {
  const [log, setLog] = useState<CanvasPreviewEntry[]>([]);

  useEffect(() => {
    if (!active) return;
    const onMessage = (event: MessageEvent) => {
      // Scoped to THIS frame — see the header. A board can hold several previews and they
      // all post to the same `window`.
      if (event.source !== frameRef.current?.contentWindow) return;
      const entry = canvasPreviewEntry(event.data);
      if (entry) setLog((current) => appendCanvasPreviewEntry(current, entry));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [active, frameRef]);

  const reset = useCallback(() => setLog([]), []);
  return { log, summary: canvasPreviewSummary(log), reset };
}
