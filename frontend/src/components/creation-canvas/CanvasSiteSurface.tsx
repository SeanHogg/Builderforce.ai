/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components. Its own
 * header says it: the directive is sometimes the bug.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import { CanvasObjectSurface } from './CanvasObjectSurface';
import { WebsiteBody } from './WebsiteCanvas';
import { websitePagesFrom } from './websiteWysiwyg';
import type { CreationNodeData } from './types';

/**
 * A site at a width you choose — the site runtime.
 *
 * ── WHY THIS IS NOT THE `page` SURFACE ───────────────────────────────────────────
 * A résumé and a landing page are both "a document" only if you stop looking. A page has
 * ONE sheet and a reading measure; a site has a set of pages you move between, and a
 * width that is part of the artefact rather than a property of the monitor. Those are two
 * axes `pageSheet` does not have, and folding them in would have meant a sheet that is
 * sometimes 880px of prose and sometimes 390px of phone chrome depending on the kind —
 * the exact per-kind branch the surface registry exists to avoid.
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────────
 * `WebsiteBody` already rendered every page, section kind and theme — in a ~455px card,
 * where a desktop layout is drawn at a third of the width it was designed for and the
 * page nav competes with the card's own title. Like `page`, `play` and `timeline` before
 * it this surface introduces no new editor: it is the same renderer with the room its
 * content assumes, plus the one control the card cannot offer.
 *
 * ── WHY THE VIEWPORT IS LOCAL AND NOT PERSISTED ──────────────────────────────────
 * `data.viewport` is what the site IS — the width the author is designing for, and what a
 * board preview and an export both read. The control here is what the READER is currently
 * checking, which is a different question with a different lifetime: looking at a desktop
 * site on a phone frame for a moment must not quietly re-author it. So it starts from the
 * object's own viewport and stays in this component; only `WebsiteBody`'s page nav writes
 * back, because which page is open genuinely belongs to the object.
 */

const VIEWPORTS = ['desktop', 'tablet', 'mobile'] as const;
type SiteViewport = (typeof VIEWPORTS)[number];

export interface CanvasSiteSurfaceProps {
  data: CreationNodeData;
  onExit: () => void;
  /** Absent on a board the viewer cannot drive; the page nav then reads without writing. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}

export function CanvasSiteSurface({ data, onExit, onEdit }: CanvasSiteSurfaceProps) {
  const t = useTranslations('creationCanvas');
  const [viewport, setViewport] = useState<SiteViewport>(
    data.viewport === 'mobile' || data.viewport === 'tablet' ? data.viewport : 'desktop',
  );
  // Derived, never stored: a count beside the pages that produce it is a number the rows
  // can contradict the moment Brain adds one.
  const pageCount = websitePagesFrom(data).length;

  const actions = <span className={styles.siteMeta}>
    <span className={styles.siteViewports} role="group" aria-label={t('surface.site.viewport')}>
      {VIEWPORTS.map((option) => <button
        key={option}
        type="button"
        onClick={() => setViewport(option)}
        aria-pressed={viewport === option}
        title={t(`surface.site.${option}` as 'surface.site.desktop')}
      >{t(`surface.site.${option}` as 'surface.site.desktop')}</button>)}
    </span>
    <small>{t('surface.site.pageCount', { count: pageCount })}</small>
  </span>;

  return (
    <CanvasObjectSurface surface="site" data={data} onExit={onExit} actions={actions}>
      <div className={styles.siteStage} data-viewport={viewport}>
        <div className={styles.siteFrame}>
          <WebsiteBody data={data} viewport={viewport} {...(onEdit ? { onEdit } : {})} />
        </div>
      </div>
    </CanvasObjectSurface>
  );
}
