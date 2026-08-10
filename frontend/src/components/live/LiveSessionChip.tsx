'use client';

import { useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useOptionalLiveSession } from '@/lib/live/LiveSessionContext';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import styles from './LiveSessionChip.module.css';

/**
 * "Who is here with you" — the third thing the session bar must carry, beside
 * who you are working as and what you are working on.
 *
 * It lives in the session bar rather than on the board for the same reason the
 * room does: a call you can only start, see or leave from one page is a call
 * that belongs to that page. Starting one here anchors it to the board you have
 * open, and it then follows you everywhere.
 *
 * Self-gating: no tenant, no chip. No board to anchor a room to, no chip — a
 * "start a call about nothing" button has no meaning.
 */
export function LiveSessionChip() {
  const t = useTranslations('liveChip');
  const { tenant, hasTenant } = useAuth();
  const live = useOptionalLiveSession();
  const canvas = useOptionalActiveCanvas();
  const scope = useOptionalProjectScope();
  const pathname = usePathname() || '';

  const active = canvas?.active ?? null;
  const start = live?.start;

  const toggle = useCallback(() => {
    if (!live) return;
    if (live.live) { live.leave(); return; }
    if (!active || !start) return;
    start({
      // The room key is the BOARD, not the route — which is what makes the call
      // survive navigating away from it, and what lets someone arriving at the
      // same board join the call already in progress.
      roomKey: `canvas:${active.sessionId}`,
      label: t('onThisCanvas'),
      scopeLabel: [tenant?.name, scope?.currentProject?.name].filter(Boolean).join(' › '),
      tenantId: tenant?.id ?? null,
      href: `/create/${active.sessionId}`,
    });
  }, [active, live, scope?.currentProject?.name, start, t, tenant?.id, tenant?.name]);

  if (!hasTenant || !live) return null;
  // Nothing to anchor a room to, and not already in one.
  if (!live.live && !active) return null;
  // Hidden on the canvas library itself, where the live bar's own controls are
  // the better affordance and a second control would be a second answer.
  if (!live.live && pathname === '/create') return null;

  const onCall = live.members.filter((member) => member.onCall).length;

  return (
    <button
      type="button"
      className={`tenant-chip ${styles.chip}`}
      data-on={live.live ? '1' : '0'}
      onClick={toggle}
      aria-pressed={live.live}
      title={live.live ? t('leaveTitle') : t('startTitle')}
    >
      {live.live && <span className={styles.pulse} aria-hidden="true" />}
      <span className={styles.label}>
        {live.live ? t('liveWithCount', { count: onCall }) : t('start')}
      </span>
    </button>
  );
}
