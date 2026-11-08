import { useTranslations } from 'next-intl';
import styles from '../styles/creativeEditors.module.css';
import { COMIC_LAYOUTS, layoutOf, type ComicLayoutId, type ComicPage, type ComicState } from '@/lib/creation/comic/comicState';

interface ComicPageRailProps {
  state: ComicState;
  page: ComicPage;
  editable: boolean;
  onSelect: (pageId: string) => void;
  onAdd: (layout: ComicLayoutId) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  onLayout: (layout: ComicLayoutId) => void;
}

const LAYOUT_KEY = { single: 'layoutSingle', stacked: 'layoutStacked', headline: 'layoutHeadline', grid: 'layoutGrid' } as const;

/** The page strip, and — on an editable board — adding, removing, reordering and
 *  re-laying-out pages. Each page button carries the number of choices it offers. */
export function ComicPageRail({ state, page, editable, onSelect, onAdd, onRemove, onMove, onLayout }: ComicPageRailProps) {
  const t = useTranslations('canvas.kinds.comic');
  const index = state.pages.indexOf(page);
  const layout = layoutOf(page, state);
  return <div className={styles.rail}>
    <div className={styles.railHead}>
      <b>{t('pages')}</b>
      {editable && <div className={styles.railActions}>
        <button type="button" className={styles.iconButton} onClick={() => onMove(-1)} disabled={index <= 0} aria-label={t('movePageEarlier')} title={t('movePageEarlier')}>‹</button>
        <button type="button" className={styles.iconButton} onClick={() => onMove(1)} disabled={index >= state.pages.length - 1} aria-label={t('movePageLater')} title={t('movePageLater')}>›</button>
        <button type="button" className={styles.iconButton} onClick={() => onAdd(layout ?? 'headline')} aria-label={t('addPage')} title={t('addPage')}>+</button>
        <button type="button" className={styles.iconButton} onClick={onRemove} disabled={state.pages.length <= 1} aria-label={t('deletePage')} title={t('deletePage')}>×</button>
      </div>}
    </div>
    <ol className={`${styles.pageTabs} nodrag nowheel`}>
      {state.pages.map((entry, at) => <li key={entry.id}>
        <button type="button" className={styles.button} data-active={entry.id === page.id || undefined} aria-pressed={entry.id === page.id} onClick={() => onSelect(entry.id)}>
          {t('pageNumber', { index: at + 1 })}
          {entry.branches.length > 0 && <small>{entry.branches.length}</small>}
        </button>
      </li>)}
    </ol>
    {editable && <label className={styles.field}>
      <span>{t('layout')}</span>
      <select value={layout ?? ''} onChange={(event) => onLayout(event.target.value as ComicLayoutId)}>
        {layout === null && <option value="" disabled>{t('layoutCustom')}</option>}
        {COMIC_LAYOUTS.map((id) => <option key={id} value={id}>{t(LAYOUT_KEY[id])}</option>)}
      </select>
    </label>}
  </div>;
}
