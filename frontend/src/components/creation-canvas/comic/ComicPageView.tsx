import { useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../styles/creativeEditors.module.css';
import type { ComicPage, ComicState } from '@/lib/creation/comic/comicState';
import { useAuthedMediaUrl } from '@/lib/useAuthedMediaUrl';

interface ComicPageViewProps {
  page: ComicPage;
  size: Pick<ComicState, 'width' | 'height'>;
  /** Highlights one panel; panels become buttons that call `onSelectPanel`. */
  selectedPanelId?: string | null;
  onSelectPanel?: (panelId: string) => void;
  /** Accessible name of a panel, given its 1-based position. */
  panelLabel: (index: number) => string;
  pageLabel: string;
}

/** A panel's art, or — when what was stored is unusable or fails to load — the localized "image missing" state rather than a silent grey. */
function PanelArt({ url, missing }: { url: string | null; missing: boolean }) {
  const t = useTranslations('canvas.kinds.comic');
  // The url that failed to render; a different url reads as not failed, without resetting state.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl !== null && failedUrl === url;
  const authed = useAuthedMediaUrl(url);
  if (authed.url && !failed) return <img src={authed.url} alt="" draggable={false} onError={() => setFailedUrl(url)} />;
  if (authed.loading) return null;
  return missing || failed || authed.error ?<span className={styles.imageMissing} role="img" aria-label={t('imageMissing')}>{t('imageMissing')}</span> : null;
}

/**
 * One comic page, drawn from the same fractional coordinates the exporter paints from.
 * It is the single page renderer for the editor and the reader, so the two cannot show
 * a page differently. Text is HTML, not canvas, so it follows the board's text scaling
 * and is read aloud by assistive tech.
 */
export function ComicPageView({ page, size, selectedPanelId, onSelectPanel, panelLabel, pageLabel }: ComicPageViewProps) {
  return <div className={styles.comicPage} style={{ aspectRatio: `${size.width} / ${size.height}` }} role="group" aria-label={pageLabel}>
    {page.panels.map((panel, index) => {
      const place = { left: `${panel.x * 100}%`, top: `${panel.y * 100}%`, width: `${panel.w * 100}%`, height: `${panel.h * 100}%` };
      const content = <>
        <PanelArt url={panel.imageUrl} missing={panel.imageMissing === true} />
        {panel.bubbles.map((bubble) => bubble.text.trim() && <span
          key={bubble.id}
          className={styles.bubble}
          data-kind={bubble.kind}
          style={{ left: `${bubble.x * 100}%`, top: `${bubble.y * 100}%` }}
        >{bubble.text}</span>)}
      </>;
      return onSelectPanel
        ? <button
          key={panel.id}
          type="button"
          className={`${styles.panel} nodrag`}
          data-selected={panel.id === selectedPanelId || undefined}
          style={place}
          aria-label={panelLabel(index + 1)}
          aria-pressed={panel.id === selectedPanelId}
          onClick={() => onSelectPanel(panel.id)}
        >{content}</button>
        : <div key={panel.id} className={styles.panel} style={place} role="img" aria-label={panelLabel(index + 1)}>{content}</div>;
    })}
  </div>;
}
