/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components. Its own
 * header says it: the directive is sometimes the bug.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { canvasViewport, type CanvasViewport } from '@/lib/canvasViewport';
import styles from './CreationCanvas.module.css';
import { CanvasObjectSurface } from './CanvasObjectSurface';
import { CanvasViewportSwitcher } from './CanvasViewportSwitcher';
import { WebsiteBody, WebsiteFrame } from './WebsiteCanvas';
import {
  WEBSITE_ADDABLE_SECTION_KINDS,
  activeWebsitePage,
  applyWebsiteEdit,
  websitePagesFrom,
  websiteSectionCapabilities,
  type WebsiteSection,
  type WebsiteSectionKind,
  type WebsiteStructuralEdit,
} from './websiteWysiwyg';
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
 * it this surface introduces no new renderer: it is the same one with the room its
 * content assumes, plus the controls the card cannot offer.
 *
 * ── WHY STRUCTURE IS EDITED HERE AND NOWHERE ELSE ────────────────────────────────
 * The card could change a hero's words, and that was the whole of it: a creator could
 * retitle their landing page and could not rearrange it, which is the one thing a brand
 * page exists to let a non-developer do. The operations themselves are NOT here — they
 * are pure functions in the shared contract, so Brain adding a section and a person
 * adding a section take the same path through the same caps and the same refusals. This
 * component owns only the buttons, and it owns them here rather than on the card because
 * structural editing needs to show what moved, which a preview has no room to do.
 *
 * ── WHY THERE ARE TWO READINGS AND NOT ONE ───────────────────────────────────────
 * The two things an author does with a site full-size need opposite properties. CHECKING
 * it needs the real document, isolated: the same self-contained page the publisher serves,
 * at a real device width, with nothing of the app's cascade able to reach it — the defect
 * that made this surface show a landing page repainted by the operator's dark-mode toggle,
 * in 7px type, with the features grid reduced to a heading. EDITING it needs the opposite:
 * markup in this document, reachable by React, so a section can be moved and a heading
 * retitled in place. No single renderer is both, and pretending one was is what produced
 * an approximation that was neither a faithful preview nor a comfortable editor. So this
 * is the same split the `app` surface already makes between Preview, Code and Console —
 * one artifact, read more than one way — and the switch is one control, not a mode the
 * user has to infer.
 *
 * ── WHY THE SITE'S OWN LIGHT/DARK IS THE AUTHOR'S, NOT THE APP'S ─────────────────
 * The published document answers `prefers-color-scheme`, because it is served to strangers
 * on their own devices. A preview must not: the author toggling the CANVAS to dark was
 * repainting their site, which reads as the app styling the artifact and hides what half
 * their visitors see. So the preview pins the mode and this surface hands the author the
 * switch — a question about the site, asked in the site's own controls.
 *
 * ── WHY THE VIEWPORT IS LOCAL AND NOT PERSISTED ──────────────────────────────────
 * `data.viewport` is what the site IS — the width the author is designing for, and what a
 * board preview and an export both read. The control here is what the READER is currently
 * checking, which is a different question with a different lifetime: looking at a desktop
 * site on a phone frame for a moment must not quietly re-author it. So it starts from the
 * object's own viewport and stays in this component; only `WebsiteBody`'s page nav writes
 * back, because which page is open genuinely belongs to the object.
 */

/* The widths themselves come from `lib/canvasApp`, which already declared them for the
   surface that runs an app — one list, so a width added there cannot appear on one
   preview and not the other. */

export interface CanvasSiteSurfaceProps {
  data: CreationNodeData;
  onExit: () => void;
  /** Absent on a board the viewer cannot drive; the page nav then reads without writing,
   *  and the structural controls stand down entirely rather than being drawn disabled. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}

/** The two ways to read a site, in the order an author wants them: see it, then change
 *  it. Data rather than two booleans, so the toggle is one loop and one catalogue key. */
const READINGS = ['preview', 'edit'] as const;
type SiteReading = (typeof READINGS)[number];

const SCHEMES = ['light', 'dark'] as const;
type SiteScheme = (typeof SCHEMES)[number];

export function CanvasSiteSurface({ data, onExit, onEdit }: CanvasSiteSurfaceProps) {
  const t = useTranslations('creationCanvas');
  const [viewport, setViewport] = useState<CanvasViewport>(canvasViewport(data.viewport));
  const [reading, setReading] = useState<SiteReading>('preview');
  const [scheme, setScheme] = useState<SiteScheme>('light');
  // Derived, never stored: a count beside the pages that produce it is a number the rows
  // can contradict the moment Brain adds one.
  const pages = websitePagesFrom(data);
  const page = activeWebsitePage(pages, data.activeWebsitePageId);

  // ONE dispatch for every structural button. `applyWebsiteEdit` returns null when the
  // document refuses the edit, and a refusal must not travel on as a write — otherwise
  // pressing "delete" on the last section bumps the canvas revision and marks the board
  // dirty to change nothing.
  const edit = (change: WebsiteStructuralEdit): void => {
    if (!onEdit) return;
    const patch = applyWebsiteEdit(data, change);
    if (patch) onEdit(patch);
  };

  // Structural chrome belongs to the EDIT reading only: it is markup drawn between the
  // sections, and there is nowhere to put it over a framed document that would not be a
  // second, guessed-at layout of a page the frame already owns.
  const sectionControls = onEdit && page && reading === 'edit'
    ? (section: WebsiteSection) => {
      // The rules live with the operations. Asking the contract what is possible —
      // rather than re-deriving "is this the hero" and "is this the last one" here —
      // is what keeps a disabled button and a refused edit the same answer.
      const can = websiteSectionCapabilities(page, section.id);
      return <span className={styles.siteSectionTools} aria-label={t('surface.site.sectionTools', { kind: section.kind })}>
        <span className={styles.siteSectionKind}>{section.kind}</span>
        <button
          type="button" onClick={() => edit({ op: 'move', sectionId: section.id, direction: 'up' })}
          disabled={!can.canMoveUp} title={t('surface.site.moveUp')} aria-label={t('surface.site.moveUp')}
        >↑</button>
        <button
          type="button" onClick={() => edit({ op: 'move', sectionId: section.id, direction: 'down' })}
          disabled={!can.canMoveDown} title={t('surface.site.moveDown')} aria-label={t('surface.site.moveDown')}
        >↓</button>
        <button
          type="button" onClick={() => edit({ op: 'duplicate', sectionId: section.id })}
          disabled={!can.canDuplicate} title={t('surface.site.duplicate')} aria-label={t('surface.site.duplicate')}
        >⧉</button>
        <button
          type="button" onClick={() => edit({ op: 'delete', sectionId: section.id })}
          disabled={!can.canDelete} title={t('surface.site.delete')} aria-label={t('surface.site.delete')}
        >✕</button>
      </span>;
    }
    : undefined;

  const actions = <span className={styles.siteMeta}>
    <span className={styles.appReadings} role="group" aria-label={t('surface.site.readings')}>
      {READINGS.map((option) => <button
        key={option}
        type="button"
        onClick={() => setReading(option)}
        aria-pressed={reading === option}
      >{t(`surface.site.reading.${option}` as 'surface.site.reading.preview')}</button>)}
    </span>

    {/* The SITE's mode, not the app's — see the header. Only in the reading that shows
        the real document; the editor draws the author's own theme colours directly. */}
    {reading === 'preview' && <span className={styles.siteScheme} role="group" aria-label={t('surface.site.scheme')}>
      {SCHEMES.map((option) => <button
        key={option}
        type="button"
        onClick={() => setScheme(option)}
        aria-pressed={scheme === option}
      >{t(`surface.site.scheme${option === 'light' ? 'Light' : 'Dark'}` as 'surface.site.schemeLight')}</button>)}
    </span>}

    {onEdit && page && reading === 'edit' && <span className={styles.siteAdd}>
      <label htmlFor="site-add-section">{t('surface.site.addSection')}</label>
      <select
        id="site-add-section"
        value=""
        onChange={(event) => {
          const kind = event.target.value as WebsiteSectionKind;
          if (kind) edit({ op: 'insert', kind });
          // Back to the prompt: this is an action list, not a field with a value —
          // leaving the last choice selected would read as the page's current state.
          event.target.value = '';
        }}
      >
        <option value="">{t('surface.site.addSectionPrompt')}</option>
        {WEBSITE_ADDABLE_SECTION_KINDS.map((kind) => <option key={kind} value={kind}>
          {t(`surface.site.section.${kind}` as 'surface.site.section.features')}
        </option>)}
      </select>
    </span>}
    {/* THE width switcher, shared with the App surface — see `CanvasViewportSwitcher`
        for why this is one component and not two copies of three buttons. */}
    <CanvasViewportSwitcher value={viewport} onChange={setViewport} />
    <small>{t('surface.site.pageCount', { count: pages.length })}</small>
  </span>;

  return (
    <CanvasObjectSurface surface="site" data={data} onExit={onExit} actions={actions}>
      <div className={styles.siteStage} data-viewport={viewport} data-reading={reading}>
        {reading === 'preview'
          ? <WebsiteFrame
              data={data}
              viewport={viewport}
              colorScheme={scheme}
              className={styles.siteFrame}
              {...(onEdit ? { onEdit } : {})}
            />
          : <div className={styles.siteFrame}>
              <WebsiteBody
                data={data}
                viewport={viewport}
                {...(onEdit ? { onEdit } : {})}
                {...(sectionControls ? { sectionControls } : {})}
              />
            </div>}
      </div>
    </CanvasObjectSurface>
  );
}
