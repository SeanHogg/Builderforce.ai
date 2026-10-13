/**
 * Areas mode and the row highlight (PRD 33 §2.1 "Areas", §8 S4).
 *
 * Areas: one box per top element with its share of the route's clicks, the
 * box taken from the rebuilt page (`locateElement` → its rect). The highlight
 * is the same box for ONE selector — the element-table row under the pointer.
 * Both draw in page pixels inside `PageBackground`'s scaled page; an element
 * the snapshot does not contain (it rendered later, or is masked) simply has
 * no box, which the table still lists.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayElementRowDto } from '@builderforce/interaction-contract';
import { useFormat } from '@/i18n/useFormat';
import { locateElement, pageRectOf, type PageRect } from './locateElement';
import styles from './heatmap.module.css';

/** Elements boxed in Areas mode. */
export const AREAS_TOP = 8;

function rectFor(doc: Document | null, selector: string): PageRect | null {
  if (!doc) return null;
  const el = locateElement(doc, selector);
  return el ? pageRectOf(el) : null;
}

export interface AreasOverlayProps {
  doc: Document | null;
  elements: readonly ReplayElementRowDto[];
  /** Re-measure when the page's size settles. */
  pageHeight: number;
  top?: number;
}

export function AreasOverlay({ doc, elements, pageHeight, top = AREAS_TOP }: AreasOverlayProps) {
  const t = useTranslations('replay.heat');
  const fmt = useFormat();
  const total = elements.reduce((sum, row) => sum + row.clicks, 0);
  const boxes = useMemo(() => {
    void pageHeight; // a dependency on purpose: the rects move as the page grows
    return [...elements]
      .filter((row) => row.clicks > 0)
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, top)
      .map((row) => ({ row, rect: rectFor(doc, row.selector) }))
      .filter((box): box is { row: ReplayElementRowDto; rect: PageRect } => box.rect !== null);
  }, [doc, elements, top, pageHeight]);

  return (
    <div className={styles.layer} data-testid="heat-areas" aria-label={t('areas.aria')} role="group">
      {boxes.map(({ row, rect }) => {
        const share = total > 0 ? row.clicks / total : 0;
        const label = t('areas.share', { share: fmt.percent(share) });
        return (
          <div
            key={row.selector}
            className={styles.zone}
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            data-selector={row.selector}
            aria-label={t('areas.zoneAria', { element: row.label ?? row.selector, share: fmt.percent(share) })}
            role="img"
          >
            <span className={styles.zoneLabel}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ZoneHighlight({ doc, selector, pageHeight }: { doc: Document | null; selector: string | null; pageHeight: number }) {
  const t = useTranslations('replay.heat');
  const rect = useMemo(() => {
    void pageHeight;
    return selector ? rectFor(doc, selector) : null;
  }, [doc, selector, pageHeight]);
  if (!selector) return null;
  return (
    <div className={styles.layer}>
      <div
        data-testid="heat-highlight"
        data-selector={selector}
        data-located={rect ? 'true' : 'false'}
        className={`${styles.zone} ${styles.zoneHighlight}`}
        role="img"
        aria-label={t('highlightAria', { element: selector })}
        style={rect ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h } : { display: 'none' }}
      />
    </div>
  );
}
