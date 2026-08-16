'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Edge } from '@xyflow/react';
import styles from './CreationCanvas.module.css';
import { CanvasPanelFilters } from './CanvasPanelFilters';
import { filterOutlineNodes, outlineKindCounts } from '@/lib/canvasOutline';
import { creationObjectName } from './creationObjectRegistry';
import type { CreationFlowNode } from './CreationNode';

/**
 * The accessible canvas outline — the spatial graph as an ordered, focusable list.
 *
 * It used to sit permanently on the board as a `<details>` widget that nobody could
 * dismiss. It is now opened from the accessibility control on the canvas command
 * rail and closes like every other canvas panel, so assistive-technology users get
 * the same "open it when I want it" control as everyone else.
 *
 * It is ALSO the board's only find-things surface. The canvas has one other search
 * box and it filters the palette of object TYPES you can add, not the objects you
 * have — so before this panel could search, a board past about thirty objects had
 * no way to answer "where is the pricing deck" except by looking. Search and the
 * kind chips therefore live here rather than being a fourth floating control: this
 * is already the list of everything, and a keyboard user reaching for search
 * should land somewhere they can act on the result.
 *
 * Matching, ranking and bucketing are pure and unit-tested in `lib/canvasOutline`;
 * this renders what they return.
 */
export function CanvasOutlinePanel({
  nodes, edges, onFocus, onClose,
}: {
  nodes: CreationFlowNode[];
  edges: Edge[];
  /** Anchored from the button itself — the card this focuses may be off-screen,
   *  so the config panel opens beside the control that asked for it. */
  onFocus: (nodeId: string, rect: DOMRect) => void;
  onClose: () => void;
}) {
  const t = useTranslations('creationCanvas');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');

  const kinds = useMemo(() => outlineKindCounts(nodes), [nodes]);
  const visible = useMemo(() => filterOutlineNodes(nodes, { query: search, kind }), [nodes, search, kind]);
  // Titles are resolved once per render rather than inside the per-edge lookup
  // below, which was O(nodes × edges) on every keystroke.
  const titleById = useMemo(() => new Map(nodes.map((node) => [node.id, creationObjectName(node.data)])), [nodes]);
  const chips = useMemo(() => [
    { value: 'all', label: t('outlineFilterAll', { count: nodes.length }) },
    ...kinds.map(({ kind: value, count }) => ({ value, label: `${t(`object.${value}` as 'object.task')} ${count}` })),
  ], [kinds, nodes.length, t]);

  return (
    <aside className={styles.canvasOutline} aria-label={t('canvasOutline')}>
      <header>
        <strong>{t('canvasOutline')}</strong>
        <button type="button" aria-label={t('closeCanvasOutline')} title={t('closeCanvasOutline')} onClick={onClose}>×</button>
      </header>
      {nodes.length > 0 && <CanvasPanelFilters
        search={search}
        onSearchChange={setSearch}
        searchLabel={t('outlineSearch')}
        filterGroupLabel={t('outlineFilterByKind')}
        filter={kind}
        onFilterChange={setKind}
        chips={chips}
      />}
      {nodes.length === 0
        ? <p className={styles.canvasOutlineEmpty}>{t('canvasOutlineEmpty')}</p>
        : visible.length === 0
          ? <p className={styles.canvasOutlineEmpty}>{t('outlineNoMatches')}</p>
          : <>
            {/* Announced politely so a screen reader hears the result count change
                as the query is typed, rather than silently re-rendering the list. */}
            <p className={styles.canvasOutlineCount} role="status">
              {t('outlineShowing', { shown: visible.length, total: nodes.length })}
            </p>
            <ol>{visible.map((node) => <li key={node.id}>
              {/* Named through the shared rule, so a blank-by-design object (a new
                  sticky note) is still a control with a name rather than "Focus ". */}
              <button type="button" aria-label={t('focusObject', { title: creationObjectName(node.data) })} onClick={(event) => onFocus(node.id, event.currentTarget.getBoundingClientRect())}>{creationObjectName(node.data)} ({node.data.kind})</button>
              <span>{String(node.data.status || t('canvasObject'))}{node.data.placementLocked === true ? ` · ${t('placementLocked')}` : ''}</span>
              <ul>{edges.filter((edge) => edge.source === node.id).map((edge) => <li key={edge.id}>
                {t('outlineConnection', {
                  kind: String(edge.data?.connectionKind || 'reference'),
                  target: titleById.get(edge.target) || t('genericObject'),
                })}{edge.label ? `: ${String(edge.label)}` : ''}
              </li>)}</ul>
            </li>)}</ol>
          </>}
    </aside>
  );
}
