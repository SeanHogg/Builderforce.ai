'use client';

import { useState, type CSSProperties, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { getWidget } from '@/lib/widgets/registry';
import type { WidgetSize } from '@/lib/widgets/types';
import { usePins } from '@/lib/widgets/PinsProvider';
import { WidgetCard } from './WidgetCard';

/**
 * The personal "My Dashboard" grid with drag-to-reorder. Wraps {@link WidgetCard}
 * (same layout as WidgetGrid so cards read identically) and adds:
 *   - native HTML5 drag-and-drop (no new dependency), and
 *   - keyboard-accessible ◀/▶ move buttons (native drag has no keyboard a11y),
 * both committing the new order through {@link usePins}().reorder — optimistic,
 * server-persisted. Unknown ids (a pinned widget whose surface was removed) are
 * dropped so a stale pin never breaks the dashboard.
 */

const SPAN: Record<WidgetSize, CSSProperties> = {
  sm: {},
  md: { gridColumn: 'span 2' },
  lg: { gridColumn: '1 / -1' },
};

/** Move item at `from` to `to` in a copy of the array. */
function move<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function ReorderableWidgetGrid({ ids, days }: { ids: string[]; days: number }) {
  const t = useTranslations('widgets');
  const { reorder } = usePins();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const known = ids.filter((id) => getWidget(id));

  const commitMove = (fromId: string, toId: string) => {
    const from = known.indexOf(fromId);
    const to = known.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;
    reorder(move(known, from, to));
  };

  const nudge = (id: string, dir: -1 | 1) => {
    const i = known.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= known.length) return;
    reorder(move(known, i, j));
  };

  const onDragStart = (id: string) => (e: DragEvent) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };
  const onDragOver = (id: string) => (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overId !== id) setOverId(id);
  };
  const onDrop = (id: string) => (e: DragEvent) => {
    e.preventDefault();
    if (dragId) commitMove(dragId, id);
    setDragId(null);
    setOverId(null);
  };
  const onDragEnd = () => { setDragId(null); setOverId(null); };

  const handleBtn: CSSProperties = {
    border: 'none', background: 'transparent', cursor: 'pointer',
    color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1, padding: '2px 4px', borderRadius: 6,
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, alignItems: 'stretch' }}>
      {known.map((id, i) => {
        const def = getWidget(id)!;
        const isOver = overId === id && dragId !== id;
        return (
          <div
            key={id}
            style={{
              ...SPAN[def.size ?? 'sm'],
              position: 'relative',
              opacity: dragId === id ? 0.4 : 1,
              outline: isOver ? '2px dashed var(--coral-bright, #f4726e)' : 'none',
              outlineOffset: 2,
              borderRadius: 12,
              transition: 'opacity 120ms ease',
            }}
            onDragOver={onDragOver(id)}
            onDrop={onDrop(id)}
          >
            {/* Drag + keyboard reorder handle (top-left, over the card chrome). */}
            <div
              style={{ position: 'absolute', top: 6, left: 6, zIndex: 2, display: 'flex', alignItems: 'center', gap: 2, background: 'var(--bg-elevated)', borderRadius: 6, padding: '1px 2px' }}
            >
              <span
                draggable
                onDragStart={onDragStart(id)}
                onDragEnd={onDragEnd}
                title={t('reorder.drag')}
                role="button"
                aria-label={t('reorder.drag')}
                style={{ ...handleBtn, cursor: 'grab' }}
              >⠿</span>
              <button type="button" style={handleBtn} disabled={i === 0} onClick={() => nudge(id, -1)} aria-label={t('reorder.moveLeft')} title={t('reorder.moveLeft')}>◀</button>
              <button type="button" style={handleBtn} disabled={i === known.length - 1} onClick={() => nudge(id, 1)} aria-label={t('reorder.moveRight')} title={t('reorder.moveRight')}>▶</button>
            </div>
            <WidgetCard def={def} days={days} />
          </div>
        );
      })}
    </div>
  );
}
