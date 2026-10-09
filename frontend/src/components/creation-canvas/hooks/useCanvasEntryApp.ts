/**
 * The app a LENS expects, created once when a board is entered without one.
 *
 * No 'use client' directive: a hook, imported only from inside the `CreationCanvas`
 * client boundary (the same rule `CanvasAppSurface.tsx` states at its top).
 *
 * The Studio lens opens a board on its App surface, and Studio is prompt + preview — so a
 * board entered through it with no app gets one, of the lens's modality, BEFORE the
 * Brain's first turn runs. That ordering is the point: a first turn that starts on a
 * board with no build authors cards about the request; a first turn that starts on a
 * board WITH one writes the app (`canvas_create_build` is still there if this fails).
 *
 * Three rules, each a bug it prevents:
 *   - only once the board AS LOADED is on screen (`boardLoaded`), never against the
 *     starter seed that precedes it — that is how a reload would create a second app;
 *   - only once per mount, and the condition re-reads the board, so Back and reload are
 *     safe: a board that has an app is never given another;
 *   - a failure RELEASES the first turn rather than holding it forever — the turn runs and
 *     the Brain can make the build itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { canvasAppFiles } from '@/lib/canvasApp';
import { sessionHasApp } from '@/lib/canvasSessionApp';
import type { ProjectModality } from '@/lib/modality';
import { reportBackgroundFailure } from '@/lib/reportError';
import type { CanvasSessionAppActions } from './useCanvasSessionApp';
import type { CreationFlowNode } from '../CreationNode';

export interface EntryAppFacts {
  /** The modality the lens expects; null = this lens expects no app. */
  modality: ProjectModality | null;
  /** The loaded board is on screen. */
  boardLoaded: boolean;
  /** The viewer may add objects to this board. */
  canEdit: boolean;
  /** The board already has something the App surface runs (`sessionHasApp`). */
  hasApp: boolean;
  /** Code cards the App surface will turn into the app itself (its own auto-create). */
  hasCodeCards: boolean;
  /** The create this mount started was refused. */
  failed: boolean;
}

/**
 * The decision, pure: whether a create is due, and whether the first turn must still
 * wait. "Only once per mount" is the hook's ref, not a fact here — the ref is what makes it
 * once even while the create is in flight. `pending` holds from the first render — before the create has even started —
 * so the first-turn effects can never slip in during the commit between "loaded" and
 * "creating".
 */
export function entryAppDecision(facts: EntryAppFacts): { create: boolean; pending: boolean } {
  const expects = facts.modality != null && facts.canEdit && !facts.hasApp && !facts.hasCodeCards;
  return {
    create: expects && facts.boardLoaded && !facts.failed,
    pending: expects && !facts.failed,
  };
}

export interface UseCanvasEntryAppDeps {
  boardLoaded: boolean;
  nodes: readonly CreationFlowNode[];
  modality: ProjectModality | null;
  canEdit: boolean;
  /** The name a created app starts with — the board's title, or the default app title. */
  appTitle: string;
  createApp: CanvasSessionAppActions['createApp'];
}

export function useCanvasEntryApp({ boardLoaded, nodes, modality, canEdit, appTitle, createApp }: UseCanvasEntryAppDeps): { pending: boolean; failed: boolean } {
  const startedRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const hasApp = useMemo(() => sessionHasApp(nodes), [nodes]);
  const hasCodeCards = useMemo(() => canvasAppFiles(nodes).length > 0, [nodes]);
  const { create, pending } = entryAppDecision({ modality, boardLoaded, canEdit, hasApp, hasCodeCards, failed });

  useEffect(() => {
    if (!create || !modality || startedRef.current) return;
    startedRef.current = true;
    void createApp({ title: appTitle, modality }).catch((error: unknown) => {
      setFailed(true);
      void reportBackgroundFailure({
        title: 'CanvasEntryAppCreateFailed',
        message: error instanceof Error ? error.message : String(error),
        level: 'warning',
        context: { modality },
      });
    });
  }, [appTitle, create, createApp, modality]);

  return { pending, failed };
}
