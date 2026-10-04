/** The session's action journal and the Brain's runtime facts — completions, disabled models, provenance. */
import { useCallback, useEffect, useRef } from 'react';
import { createCanvasJournal } from '@/lib/canvasActionJournal';
import { readStoredJournal, writeStoredJournal } from '@/lib/canvasJournalStore';
import type { CanvasAiCompletion } from '@/lib/creationCanvasAi';

export interface UseCanvasBrainRuntimeDeps {
  sessionId: string;
}

export function useCanvasBrainRuntime({ sessionId }: UseCanvasBrainRuntimeDeps) {
  /**
   * PRESENTATION AND FOLLOW ARE SHELL STATE NOW.
   *
   * Both used to be `useState` here, which meant leaving the board ended the
   * presentation and dropped whoever you were following — so "let me show you
   * the delivery numbers" was a way to END the thing you were doing. They live on
   * the live session, which outlives every navigation; the local fallbacks below
   * keep the board working on surfaces with no session provider (the embed tree,
   * and the tests, which mount the canvas bare).
   */
  /**
   * The action journal for THIS board — see `canvasActionJournal`. A ref rather
   * than state: recording an action must never re-render the canvas, or the act
   * of observing the board would change what is being observed.
   */
  const journalRef = useRef(createCanvasJournal());
  /**
   * The tail of the journal, in the shape a defect carries it.
   *
   * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
   * The journal already recorded exactly what a bug report needs — ordered actions
   * with durations, failures, and the ones that started and never finished — and it
   * lived only in this ref, capped at 240 entries and gone on reload. So by the time
   * anyone filed the report, the three steps that explain it no longer existed
   * anywhere. Attaching it to the defect is what makes "it did this a moment ago" a
   * reproducible claim rather than a memory.
   *
   * The FAILURES and the stalls are hoisted to the front: a twenty-row list where the
   * one red row is in the middle gets skimmed past, and that row is the report.
   */
  /**
   * Keep the journal across a reload, and flush it before the tab goes away.
   *
   * Hydrate once per session id; flush on a slow interval and on `pagehide` (which
   * fires for a reload, a navigation and a bfcache eviction, where `unload` does
   * not). Writing on every recorded action would put a storage write in the path of
   * every tool call, and the whole point of the journal is that observing the board
   * does not change it.
   */
  useEffect(() => {
    const stored = readStoredJournal(sessionId);
    if (stored.length) journalRef.current.restore(stored);
    const flush = () => writeStoredJournal(sessionId, journalRef.current.entries());
    const timer = window.setInterval(flush, 15_000);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [sessionId]);

  const recentJournalEvidence = useCallback((limit = 12) => {
    const entries = journalRef.current.entries();
    const notable = entries.filter((entry) => entry.ok === false || entry.durationMs == null);
    const recent = entries.slice(-limit);
    return [...notable, ...recent.filter((entry) => !notable.includes(entry))]
      .slice(0, limit)
      .map((entry) => ({
        at: entry.at, kind: entry.kind, label: entry.label,
        ...(entry.detail ? { detail: entry.detail.slice(0, 300) } : {}),
        ...(entry.ok != null ? { ok: entry.ok } : {}),
        ...(entry.durationMs != null ? { durationMs: entry.durationMs } : {}),
      }));
  }, []);
  /** Effective inference facts accumulated by this mounted Creation Session.
   * Kept out of render state: observing completions must not remount the board. */
  const brainRuntimeRef = useRef<{ completions: CanvasAiCompletion[]; disabledModels: string[] }>({
    completions: [], disabledModels: [],
  });
  const recordBrainCompletion = useCallback((completion: CanvasAiCompletion) => {
    brainRuntimeRef.current.completions = [...brainRuntimeRef.current.completions, completion].slice(-50);
  }, []);
  /**
   * What the LAST completion of the turn just finished actually ran on — the resolved
   * model and the tools it called. Stamped onto the assistant message so a thumb
   * pressed on it (now or after a reload) can be filed against the model that earned
   * it, exactly as the Brain chat files provenance. Without this the Canvas — a large
   * share of all model calls — could rate nothing.
   */
  const lastTurnProvenance = useCallback((): { model?: string; tools?: string[] } => {
    const last = brainRuntimeRef.current.completions[brainRuntimeRef.current.completions.length - 1];
    if (!last?.resolvedModel) return {};
    return { model: last.resolvedModel, ...(last.toolCalls.length ? { tools: last.toolCalls } : {}) };
  }, []);
  const disableBrainModel = useCallback((model: string) => {
    if (!model || brainRuntimeRef.current.disabledModels.includes(model)) return;
    brainRuntimeRef.current.disabledModels = [...brainRuntimeRef.current.disabledModels, model];
  }, []);
  return { journalRef, recentJournalEvidence, brainRuntimeRef, disableBrainModel, recordBrainCompletion, lastTurnProvenance };
}
