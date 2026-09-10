/*
 * No `'use client'` — a hook called only from `CreationCanvas.tsx`, inside its own
 * client boundary.
 */
import { useEffect, useMemo } from 'react';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { resolveStandupProject } from '@/lib/canvas/standupProject';
import type { RoomOccupant } from '@/lib/canvas/roomSeating';
import type { CanvasSessionActionHandler } from './CanvasSessionActions';
import { useRoomStandup, type RoomStandupParticipant } from './useRoomStandup';

/**
 * THE STANDUP IS A SESSION ACTION — one glyph beside "Start a call", on every surface.
 *
 * ── WHY IT LEFT THE ROOM'S BAR ───────────────────────────────────────────────────
 * The room used to publish a whole captioned group into the session bar — a project
 * picker, two step buttons and a Start button — which pushed the bar out under the
 * Brain panel and put a meeting's controls behind one surface. A standup is people
 * agreeing to talk about this canvas, which is exactly what a call is; so it is
 * filed where the call is (`cluster: 'reach'`, `lib/canvasSessionActions.ts`) and
 * drawn by the same renderer with the same chrome.
 *
 * ── WHAT DECIDES THE PROJECT ─────────────────────────────────────────────────────
 * The project a person is working IN, then the one this board names, then none —
 * `resolveStandupProject`, the same rule the host's "gather a standup" object uses.
 * There is no picker any more: walking every project was a mode the bar could not
 * afford, and a standup against the scoped project is what the button is for.
 *
 * ── WHY IT CAN BE SWITCHED OFF ───────────────────────────────────────────────────
 * A standup is a server record, and the hook behind it polls for a live one every
 * 30s once a project resolves. A canvas that lives only in this browser has no
 * record to poll for, so `enabled: false` resolves no project: the button is drawn
 * disabled and nothing is asked of the network.
 *
 * Returns a handler in the registry's own shape, so the host adds ONE line to its
 * map and learns nothing about ceremonies.
 */
export function useCanvasStandupAction(
  members: readonly RoomOccupant[],
  boardProjectId: number | null,
  enabled: boolean,
  onError: (message: string) => void,
): CanvasSessionActionHandler {
  const scope = useOptionalProjectScope();
  const projectId = enabled
    ? resolveStandupProject({ scopeProjectId: scope?.currentProjectId ?? null, boardProjectId }).projectId
    : null;

  const participants = useMemo<RoomStandupParticipant[]>(
    // Everyone on a canvas roster is a person: agents attend through their own seats
    // on the ceremony round table, not through a browser session here.
    () => members.map((member) => ({ kind: 'human' as const, ref: member.userId, name: member.displayName || member.userId })),
    [members],
  );

  const standup = useRoomStandup(projectId, participants);
  const live = !!standup.session;

  // A failed start or finish is a notice, the way every other failed session act is —
  // not a second error strip the bar would have to find room for.
  useEffect(() => {
    if (!standup.error) return;
    onError(standup.error);
    standup.dismissError();
  }, [onError, standup]);

  return useMemo<CanvasSessionActionHandler>(() => ({
    run: live ? standup.finish : standup.start,
    active: live,
    // No project to file it against, or an act already in flight. Disabled rather than
    // withdrawn: the button that WOULD start it is the explanation.
    disabled: standup.busy || projectId == null,
  }), [live, projectId, standup.busy, standup.finish, standup.start]);
}
