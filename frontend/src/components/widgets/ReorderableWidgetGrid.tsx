'use client';

import { type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { getWidget } from '@/lib/widgets/registry';
import type { WidgetSize } from '@/lib/widgets/types';
import { usePins } from '@/lib/widgets/PinsProvider';
import { useDragReorder } from '@/lib/useDragReorder';
import { WidgetCard } from './WidgetCard';

/**
 * The personal "My Dashboard" grid with drag-to-reorder. Wraps {@link WidgetCard}
 * (same layout as WidgetGrid so cards read identically) and adds:
 *   - native HTML5 drag-and-drop (no new dependency), and
 *   - keyboard-accessible ◀/▶ move buttons (native drag has no keyboard a11y),
 * both from the shared {@link useDragReorder} primitive and committing the new order
 * through {@link usePins}().reorder — optimistic, server-persisted. Unknown ids (a
 * pinned widget whose surface was removed) are dropped so a stale pin never breaks
 * the dashboard.
 */

const SPAN: Record<WidgetSize, CSSProperties> = {
  sm: {},
  md: { gridColumn: 'span 2' },
  lg: { gridColumn: '1 / -1' },
};

export function ReorderableWidgetGrid({ ids, days }: { ids: string[]; days: number }) {
  const t = useTranslations('widgets');
  const { reorder } = usePins();

  const known = ids.filter((id) => getWidget(id));
  const drag = useDragReorder(known, reorder);

  const handleBtn: CSSProperties = {
    border: 'none', background: 'transparent', cursor: 'pointer',
    color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1, padding: '2px 4px', borderRadius: 'var(--radius-sm)',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, alignItems: 'stretch' }}>
      {known.map((id, i) => {
        const def = getWidget(id)!;
        return (
          <div
            key={id}
            style={{
              ...SPAN[def.size ?? 'sm'],
              position: 'relative',
              opacity: drag.draggingKey === id ? 0.4 : 1,
              outline: drag.dropKey === id ? '2px dashed var(--coral-bright, #f4726e)' : 'none',
              outlineOffset: 2,
              borderRadius: 'var(--radius-lg)',
              transition: 'opacity 120ms ease',
            }}
            {...drag.dropTargetProps(id)}
          >
            {/* Drag + keyboard reorder handle (top-left, over the card chrome). The grip —
                not the whole card — is the drag source here: a widget card owns its own
                clicks and inner controls. */}
            <div
              style={{ position: 'absolute', top: 6, left: 6, zIndex: 2, display: 'flex', alignItems: 'center', gap: 2, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', padding: '1px 2px' }}
            >
              <span
                {...drag.dragHandleProps(id)}
                title={t('reorder.drag')}
                role="button"
                aria-label={t('reorder.drag')}
                style={{ ...handleBtn, cursor: 'grab' }}
              >⠿</span>
              <button type="button" style={handleBtn} disabled={i === 0} onClick={() => drag.nudge(id, -1)} aria-label={t('reorder.moveLeft')} title={t('reorder.moveLeft')}>◀</button>
              <button type="button" style={handleBtn} disabled={i === known.length - 1} onClick={() => drag.nudge(id, 1)} aria-label={t('reorder.moveRight')} title={t('reorder.moveRight')}>▶</button>
            </div>
            <WidgetCard def={def} days={days} />
          </div>
        );
      })}
    </div>
  );
}
