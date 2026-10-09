// No 'use client' directive: imported only from inside the `CreationCanvas` client
// boundary, like every other piece of canvas chrome.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { useConfirm } from '@/components/ConfirmProvider';
import { StudioBrand } from '@/components/studio/StudioTopBar';
import { canvasLensSessionPath, DEFAULT_CANVAS_LENS } from '@/lib/canvasLens';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { STUDIO_ROUTE } from '@/lib/studio/studioHost';
import { useContributedSurfaceActions } from '../canvasSurfaceActions';
import { useCanvasSessionFacts } from './canvasSessionContext';
import styles from '../CreationCanvas.module.css';

export interface CanvasLensBarProps {
  /** Publishes `--canvas-top-chrome-space`: everything full-bleed starts under this bar. */
  hostRef: (node: HTMLElement | null) => void;
  title: string;
  /** The outcome line the session pill would show — the lens draws no pill. */
  notice: string;
  /** The surface the lens keeps the reader on (`canvasLensHome`), or null. */
  home: CanvasSurfaceId | null;
  /** Back to `home` while the reader is somewhere else — a revealed card, a room — else null. */
  returnHome: (() => void) | null;
  /** A Brain turn is running: leaving for the Studio home would end it. */
  busy: boolean;
}

/**
 * THE STUDIO BAR — drawn in place of the session command bar when a lens draws none
 * (`lib/canvasLens.ts`, `chrome.commandBar === false`). One slim row at the top of the
 * shell: the Studio mark (home), the board's name, whatever the active SURFACE
 * contributes — the App surface's Run, Preview·Code, Files and Terminal, and what it is
 * doing — its Publish, and the way back to the full canvas.
 *
 * Zero new wiring for the surface's controls: they are the SAME contribution
 * `CanvasAppWorkspace` publishes into the command bar (`useCanvasSurfaceActions`), read
 * here instead. So Studio and the canvas can never disagree about what Run does.
 *
 * "Open on canvas" is a link to the same board on `/create/<id>` — the stage keeps the
 * board mounted across the route change, so it is the same instance with its chrome back.
 *
 * The lens draws no surface switcher, so when something takes the reader off the lens's
 * home surface (a card revealed from the conversation, a room the Brain made) THIS bar is
 * the way back. And the Studio mark leaves the stage altogether (the home is a public
 * page), which ends a Brain turn in flight — so while one is running it asks first.
 */
export function CanvasLensBar({ hostRef, title, notice, home, returnHome, busy }: CanvasLensBarProps) {
  const t = useTranslations('creationCanvas.lens');
  const tSurface = useTranslations('creationCanvas.surface');
  const tStudio = useTranslations('studio.project');
  const router = useRouter();
  const confirm = useConfirm();
  const { sessionId } = useCanvasSessionFacts();
  const { controls, status, publish } = useContributedSurfaceActions();
  const leaveForHome = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!busy) return;
    event.preventDefault();
    void confirm({ title: t('leaveTitle'), message: t('leaveMessage'), confirmLabel: t('leaveConfirm') })
      .then((leave) => { if (leave) router.push(STUDIO_ROUTE); });
  };
  return (
    <header ref={hostRef} className={styles.lensBar} aria-label={t('barLabel')}>
      <div className={styles.lensBarLead}>
        <StudioBrand compact onClick={leaveForHome} />
        <strong className={styles.lensBarTitle} title={title}>{title}</strong>
        {notice && <span className={styles.lensBarNotice} role="status">{notice}</span>}
      </div>
      {returnHome && home && (
        <button type="button" className={styles.lensBarReturn} onClick={returnHome}>
          <Icon name="chevron-left" size={14} />
          <span>{t('returnTo', { surface: tSurface(`${home}.label` as 'app.label') })}</span>
        </button>
      )}
      {(controls || status) && (
        <div className={styles.lensBarSurface}>
          {status}
          {controls}
        </div>
      )}
      <div className={styles.lensBarActions}>
        {publish && (
          <button type="button" className={styles.lensBarPublish} aria-pressed={publish.active} onClick={publish.run}>
            {tStudio('publish')}
          </button>
        )}
        <Link className={styles.appStudioLink} href={canvasLensSessionPath(DEFAULT_CANVAS_LENS, sessionId)} title={tStudio('openOnCanvasTitle')} aria-label={tStudio('openOnCanvas')}>
          <Icon name="canvas" size={14} />
          <span className={styles.lensBarLinkLabel}>{tStudio('openOnCanvas')}</span>
        </Link>
      </div>
    </header>
  );
}
