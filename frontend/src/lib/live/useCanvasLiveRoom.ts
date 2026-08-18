'use client';

import { useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalLiveSession } from '@/lib/live/LiveSessionContext';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';

/**
 * "What room does the canvas I am looking at mean, and may I open it?"
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * This answer used to live inside `LiveSessionChip`, a control in the top bar —
 * which meant the room key, the scope label and the "is there anything to anchor
 * a room to" gate were all owned by one button's render function. The moment a
 * SECOND affordance needed to start a call (the dock at the bottom of the shell,
 * which is where the control belongs now) that button would have had to be
 * imported for its logic, or the logic copied. Both are the same bug.
 *
 * So the decision is a hook and the affordances are views of it. `LiveBar` is
 * the only consumer today; that is the point — there is one place to change when
 * a room can be anchored to something other than a canvas.
 *
 * ── WHY THE ROOM KEY IS THE BOARD, NOT THE ROUTE ─────────────────────────────
 * `canvas:<sessionId>` is what makes the call survive navigating away from the
 * board, and what lets someone arriving at the same board join the call already
 * in progress. Keying it on the pathname would end the call at the first click.
 */
export interface CanvasLiveRoom {
  /** A call is running right now (on this canvas or any other). */
  live: boolean;
  /** There is a canvas to anchor a room to, and this visitor may open one. */
  canStart: boolean;
  /** How many people are on the call. Zero when there is none. */
  onCall: number;
  /** Open the room for the active canvas. No-op when {@link canStart} is false. */
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

  const startRoom = useCallback(() => {
    if (!active || !start) return;
    start({
      roomKey: `canvas:${active.sessionId}`,
      label: t('onThisCanvas'),
      scopeLabel: [tenant?.name, scope?.currentProject?.name].filter(Boolean).join(' › '),
      tenantId: tenant?.id ?? null,
      href: `/create/${active.sessionId}`,
    });
  }, [active, scope?.currentProject?.name, start, t, tenant?.id, tenant?.name]);

  const leaveRoom = useCallback(() => { leave?.(); }, [leave]);

  return useMemo(() => {
    if (!hasTenant || !live) return null;
    return {
      live: live.live,
      // Nothing to anchor a room to is not a disabled button, it is no button —
      // and the canvas LIBRARY is a list of boards rather than one of them, so
      // "start a call about which of these?" has no answer there either.
      canStart: active != null && pathname !== '/create',
      onCall: live.members.filter((member) => member.onCall).length,
      start: startRoom,
      leave: leaveRoom,
    };
  }, [active, hasTenant, live, pathname, leaveRoom, startRoom]);
}
