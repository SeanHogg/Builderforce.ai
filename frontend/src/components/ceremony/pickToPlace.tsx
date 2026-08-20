'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * TAP TO ASSIGN — the ceremony stage's drag-and-drop, for devices that cannot drag.
 *
 * Every interaction on the stage (assign to a seat, group into an epic, schedule
 * into the sprint, return to the backlog) rode native HTML5 drag-and-drop.
 * `dragstart` does not fire on touch, so the mobile-responsive pass made the
 * stage READABLE on a phone and left it entirely READ-ONLY: a mobile user could
 * see the standup and could not run it.
 *
 * Rather than adopt a pointer-based DnD library — which would replace a working
 * desktop interaction to fix a missing mobile one — the same intent is offered
 * in two steps: PICK a task, then PLACE it on any target. The pick is explicit
 * (a button on the card), so it needs no long-press timing, works with a mouse,
 * a finger, a keyboard and a screen reader alike, and every drop target keeps
 * its drag handlers untouched.
 *
 * The picked task lives here rather than in `CeremonyStage`'s state because the
 * targets are spread across four sibling components (seat, backlog rail, epic
 * rail, and the stage's own sprint/standup zones) — prop-drilling it would put
 * the same three props on each of them.
 */

interface CeremonyPickValue {
  /** The task waiting to be placed, or null. */
  pickedTaskId: number | null;
  /** Its title, for the target's accessible label. */
  pickedTitle: string | null;
  pick: (taskId: number, title: string) => void;
  clear: () => void;
}

const CeremonyPickContext = createContext<CeremonyPickValue | null>(null);

export function CeremonyPickProvider({ children }: { children: React.ReactNode }) {
  const [picked, setPicked] = useState<{ id: number; title: string } | null>(null);
  const pick = useCallback((taskId: number, title: string) => {
    // Tapping the picked task again puts it down — the gesture is its own undo.
    setPicked((current) => (current?.id === taskId ? null : { id: taskId, title }));
  }, []);
  const clear = useCallback(() => setPicked(null), []);
  const value = useMemo<CeremonyPickValue>(
    () => ({ pickedTaskId: picked?.id ?? null, pickedTitle: picked?.title ?? null, pick, clear }),
    [picked, pick, clear],
  );
  return <CeremonyPickContext.Provider value={value}>{children}</CeremonyPickContext.Provider>;
}

/**
 * Non-throwing: the task card and the rails are also rendered outside the stage
 * (the assigned-work panel, the history drawer), and a card with no provider
 * above it should simply not offer the pick affordance.
 */
export function useCeremonyPick(): CeremonyPickValue | null {
  return useContext(CeremonyPickContext);
}

/**
 * The props a drop target adds so a PICKED task can be placed on it by tapping.
 *
 * Returns `{}` when nothing is picked, so the target is an ordinary container
 * the rest of the time and gains no stray click handler, role or focus stop.
 */
export function placeTargetProps(
  pick: CeremonyPickValue | null,
  label: string,
  onPlace: (taskId: number) => void,
): Record<string, unknown> {
  if (!pick?.pickedTaskId) return {};
  const taskId = pick.pickedTaskId;
  const place = () => { onPlace(taskId); pick.clear(); };
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: place,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); place(); }
    },
    // A dashed outline in the accent hue, so every valid destination announces
    // itself the moment something is picked up.
    style: { outline: '2px dashed var(--coral-bright)', outlineOffset: 2, cursor: 'pointer' } as React.CSSProperties,
  };
}
