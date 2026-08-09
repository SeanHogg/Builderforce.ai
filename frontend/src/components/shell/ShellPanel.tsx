'use client';

/**
 * A destination, opened OVER the board that stays mounted (PRD 21 §0, §3.4).
 *
 * "**A route may change what is on screen. It may never unmount the stage.**"
 * That is the whole mechanism: the route still renders — unchanged, no page
 * component is rewritten to live here — but it renders inside the house panel
 * primitive instead of replacing the canvas. An in-flight agent turn, a peer
 * cursor, presence and an active call all belong to the session, and the session
 * outlives the navigation.
 *
 * Three things it decides rather than accepts:
 *
 *  - **Its width**, from `panelWidth(pathname)` — one of the three named widths
 *    (§2.4) and never a fourth invented at a call site.
 *  - **Its index column**, from `ShellIndex` — the destination's sub-views as a
 *    vertical list, which is what replaced the horizontal bar that could not
 *    hold Workforce's fourteen.
 *  - **Its crumb and title**, from the active nav group, so a panel over a board
 *    still says where you are without a page breadcrumb to sit in.
 *
 * Closing the panel is closing the PAGE — the board is what you go back to.
 */

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { panelWidth } from '@/lib/workbenchPolicy';
import { ShellIndex, useShellIndex } from './ShellIndex';

export function ShellPanel({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');
  const tPanel = useTranslations('shellPanel');
  const pathname = usePathname() || '';
  const router = useRouter();
  const { group, items } = useShellIndex();

  const close = useCallback(() => router.push('/create'), [router]);

  return (
    <SlideOutPanel
      open
      onClose={close}
      width={panelWidth(pathname)}
      // Per destination, not per session: widening Finance must not widen
      // Settings. Falls back to the pathname for a route with no nav group,
      // which is still stable enough to remember.
      widthStorageKey={group?.id ?? pathname}
      crumb={tPanel('crumb')}
      title={group ? t(group.labelKey) : tPanel('title')}
      // An index of one is not a choice, and `DestinationIndex` already returns
      // null for it — so the column is offered only when there is something in it.
      index={items.length > 1 ? <ShellIndex orientation="vertical" /> : undefined}
    >
      <div style={{ padding: 'var(--space-4)' }}>{children}</div>
    </SlideOutPanel>
  );
}

export default ShellPanel;
