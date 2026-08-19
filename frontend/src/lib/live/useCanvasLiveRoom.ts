// No 'use client' directive: a hook is not a boundary. Its caller (`CreationCanvas`) is
// already a client component, so the directive here marked an entry point that does not
// exist and spent a slot in the ratchet's tally.
import { useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalLiveSession } from '@/lib/live/LiveSessionContext';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';

/**
 * "What room does the surface I am looking at mean, and may I open it?"
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * This answer used to live inside `LiveSessionChip`, a control in the top bar —
 * which meant the room key, the scope label and the "is there anything to anchor
 * a room to" gate were all owned by one button's render function. The moment a
 * SECOND affordance needed to start a call (the dock at the bottom of the shell,
 * and the invite panel on a logged-out board) that button would have had to be
 * imported for its logic, or the logic copied. Both are the same bug.
 *
 * So the decision is a hook, and the one control that reads it is the canvas
 * session bar's `call` action — which is why starting a call needs no chrome of
 * its own on any surface, and why the free board gets one on the same terms as a
 * signed-in canvas. `LiveBar` renders only once a call is RUNNING.
 *
 * ── TWO KINDS OF ROOM, ONE DECISION ──────────────────────────────────────────
 * A signed-in canvas derives its room from auth: the board id is the room key,
 * and the workspace owns it. A LOGGED-OUT board cannot — it has no tenant and no
 * `creation_sessions` row — but once it has started a shared free session it has
 * a guest room code and the guest media transport, which is a real room and has
 * been since guest rooms shipped. Nothing could reach it from the canvas, so the
 * free board was the one surface where people could work together and not talk.
 *
 * The surface declares that case by publishing an anchor
 * ({@link LiveSessionValue.publishAnchor}); everything else is derived here. A
 * published anchor WINS, because a surface that knows its own room knows better
 * than a default assembled from auth.
 *
 * ── WHY THE ROOM KEY IS THE BOARD, NOT THE ROUTE ─────────────────────────────
 * `canvas:<sessionId>` is what makes the call survive navigating away from the
 * board, and what lets someone arriving at the same board join the call already
 * in progress. Keying it on the pathname would end the call at the first click.
 */
export interface CanvasLiveRoom {
  /** A call is running right now (on this canvas or any other). */
  live: boolean;
  /** There is a room to open here, and this visitor may open it. */
  canStart: boolean;
  /** How many people are on the call. Zero when there is none. */
  onCall: number;
  /** Open the room. No-op when {@link canStart} is false. */
  start: () => void;
  /** Leave the room. No-op when there is none. */
  leave: () => void;
}

export function useCanvasLiveRoom(): CanvasLiveRoom | null {
  const t = useTranslations('liveBar');
  const { tenant, hasTenant } = useAuth();
  const live = useOptionalLiveSession();
  const canvas = useOptionalActiveCanvas();
  const scope = useOptionalProjectScope();
  const pathname = usePathname() || '';

  const active = canvas?.active ?? null;
  const start = live?.start;
  const leave = live?.leave;
  const anchor = live?.anchor ?? null;
  // A signed-in board is the default room; the canvas library is a LIST of boards
  // rather than one of them, so "a call about which of these?" has no answer there.
  const canStartDefault = hasTenant && active != null && pathname !== '/create';

  const startRoom = useCallback(() => {
    if (!start) return;
    if (anchor) { start(anchor); return; }
    if (!canStartDefault || !active) return;
    start({
      roomKey: `canvas:${active.sessionId}`,
      label: t('onThisCanvas'),
      scopeLabel: [tenant?.name, scope?.currentProject?.name].filter(Boolean).join(' › '),
      tenantId: tenant?.id ?? null,
      href: `/create/${active.sessionId}`,
    });
  }, [active, anchor, canStartDefault, scope?.currentProject?.name, start, t, tenant?.id, tenant?.name]);

  const leaveRoom = useCallback(() => { leave?.(); }, [leave]);

  return useMemo(() => {
    if (!live) return null;
    return {
      live: live.live,
      canStart: anchor != null || canStartDefault,
      onCall: live.members.filter((member) => member.onCall).length,
      start: startRoom,
      leave: leaveRoom,
    };
  }, [anchor, canStartDefault, live, leaveRoom, startRoom]);
}
