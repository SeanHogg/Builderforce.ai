'use client';

import { usePathname } from 'next/navigation';
import { isStageRoute } from '@/lib/workbenchPolicy';
import { LegalStrip } from './LegalStrip';

/**
 * Copyright + version + Terms/Privacy strip for the operator shell, in the
 * BOTTOM-RIGHT corner of the frame.
 *
 * It used to hang off the bottom of the sidebar, where it competed with the
 * rail's navigation for the eye at the exact edge the board wants to be widest.
 * The shell already ends in a footer band (`TeamBar`), so this is the last row
 * of `.app-frame` and sits in normal flow — chrome in the corner can never
 * cover the canvas, and no page has to reserve space for it.
 *
 * ONE line, on every viewport: the strip never wraps. What gives at narrow
 * widths is DETAIL, not rows — the stylesheet drops the brand word from the
 * copyright and the `(v…)` suffix from each document, both of which are stated
 * elsewhere on screen, rather than pushing a second line under the canvas.
 *
 * The version is a BUTTON, exactly as it is in the marketing footer: both open
 * the one app-wide Product Updates panel (`ProductUpdatesHost`), so the
 * changelog stays reachable from wherever someone happens to be. It carries the
 * legal reader modal with it and decides its own rendering.
 */
export default function LegalCorner() {
  const pathname = usePathname() || '';

  /**
   * IT STANDS DOWN ON A STAGE ROUTE, and decides that itself.
   *
   * The doc above says the shell "already ends in a footer band (`TeamBar`)" and that
   * this is the last row after it. On a canvas neither is true any more: the board takes
   * the whole window and floats its chrome over itself, `TeamBar` folds into the command
   * bar, and a flow row under the board is simply the last strip of chrome eating height
   * the artefact should have.
   *
   * Nothing here is lost on a canvas either: `BrainDock` renders the SAME row (via
   * `LegalStrip`) as its own footer, in the normal flow of the docked Brain panel rather
   * than floating over the board — this component's job on a stage route is simply to
   * get out of the way of that one.
   */
  if (isStageRoute(pathname)) return null;

  return <LegalStrip className="legal-corner" />;
}
