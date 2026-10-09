// No 'use client' directive: imported only from inside the `CreationCanvas` client
// boundary, like every other piece of canvas chrome.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { StudioBrand } from '@/components/studio/StudioTopBar';
import { canvasLensSessionPath, DEFAULT_CANVAS_LENS } from '@/lib/canvasLens';
import { useContributedSurfaceActions } from '../canvasSurfaceActions';
import { useCanvasSessionFacts } from './canvasSessionContext';
import styles from '../CreationCanvas.module.css';

export interface CanvasLensBarProps {
  /** Publishes `--canvas-top-chrome-space`: everything full-bleed starts under this bar. */
  hostRef: (node: HTMLElement | null) => void;
  title: string;
  /** The outcome line the session pill would show — the lens draws no pill. */
  notice: string;
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
 */
export function CanvasLensBar({ hostRef, title, notice }: CanvasLensBarProps) {
  const t = useTranslations('creationCanvas.lens');
  const tStudio = useTranslations('studio.project');
  const { sessionId } = useCanvasSessionFacts();
  const { controls, status, publish } = useContributedSurfaceActions();
  return (
    <header ref={hostRef} className={styles.lensBar} aria-label={t('barLabel')}>
      <div className={styles.lensBarLead}>
        <StudioBrand compact />
        <strong className={styles.lensBarTitle} title={title}>{title}</strong>
        {notice && <span className={styles.lensBarNotice} role="status">{notice}</span>}
      </div>
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
        <Link className={styles.appStudioLink} href={canvasLensSessionPath(DEFAULT_CANVAS_LENS, sessionId)} title={tStudio('openOnCanvasTitle')}>
          <Icon name="canvas" size={14} />
          <span>{tStudio('openOnCanvas')}</span>
        </Link>
      </div>
    </header>
  );
}
