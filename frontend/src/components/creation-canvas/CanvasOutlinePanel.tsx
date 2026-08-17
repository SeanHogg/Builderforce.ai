'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Edge } from '@xyflow/react';
import styles from './CreationCanvas.module.css';
import { CanvasPanelFilters } from './CanvasPanelFilters';
import { filterOutlineNodes, outlineKindCounts } from '@/lib/canvasOutline';
import { creationObjectName } from './creationObjectRegistry';
import type { CreationFlowNode } from './CreationNode';

interface SavedOutlineView { id: string; name: string; search: string; kind: string }

/**
 * "Only blocked tasks", "only mine" cannot be named and returned to" — the second
 * half of the board-search gap the outline panel's own header records. Stored
 * per-BROWSER, not per-board or on the server: a saved search is a person's own
 * reusable query ("what I always look for"), the same kind of preference
 * `INSPECTOR_WIDTH_STORAGE_KEY` already keeps client-side in `CreationCanvas.tsx`,
 * not board state that should sync to a collaborator's screen.
 */
const SAVED_VIEWS_STORAGE_KEY = 'creationCanvas.outline.savedViews';

function loadSavedViews(): SavedOutlineView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((view): view is SavedOutlineView => !!view && typeof view.id === 'string' && typeof view.name === 'string' && typeof view.search === 'string' && typeof view.kind === 'string')
      : [];
  } catch { return []; }
}

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
  nodes, edges, onFocus, onClose, onVisibleChange,
}: {
  nodes: CreationFlowNode[];
  edges: Edge[];
  /** Anchored from the button itself — the card this focuses may be off-screen,
   *  so the config panel opens beside the control that asked for it. */
  onFocus: (nodeId: string, rect: DOMRect) => void;
  onClose: () => void;
  /**
   * The board half of this panel's own search: called with the ids this query
   * currently matches, or `null` when there is no active filter (an all-kinds,
   * empty-search list is everything, so dimming against it would dim nothing
   * usefully and cost a render). The board dims everything NOT in the set —
   * see `outlineHighlightIds` in `CreationCanvas.tsx`.
   */
  onVisibleChange?: (ids: ReadonlySet<string> | null) => void;
}) {
  const t = useTranslations('creationCanvas');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [savedViews, setSavedViews] = useState<SavedOutlineView[]>(() => loadSavedViews());
  const [newViewName, setNewViewName] = useState('');
  const hasActiveFilter = !!search.trim() || kind !== 'all';

  const persistViews = (next: SavedOutlineView[]) => {
    setSavedViews(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(next));
  };
  const saveCurrentView = () => {
    const name = newViewName.trim();
    if (!name) return;
    persistViews([...savedViews.filter((view) => view.name !== name), { id: crypto.randomUUID(), name, search, kind }]);
    setNewViewName('');
  };
  const applyView = (view: SavedOutlineView) => { setSearch(view.search); setKind(view.kind); };
  const removeView = (id: string) => persistViews(savedViews.filter((view) => view.id !== id));

  const kinds = useMemo(() => outlineKindCounts(nodes), [nodes]);
  const visible = useMemo(() => filterOutlineNodes(nodes, { query: search, kind }), [nodes, search, kind]);
  useEffect(() => {
    onVisibleChange?.(search.trim() || kind !== 'all' ? new Set(visible.map((node) => node.id)) : null);
  }, [visible, search, kind, onVisibleChange]);
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
      {(savedViews.length > 0 || hasActiveFilter) && <div className={styles.panelFilters} role="group" aria-label={t('outlineSavedViews')}>
        {savedViews.map((view) => (
          <span key={view.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <button type="button" aria-pressed={view.search === search && view.kind === kind} onClick={() => applyView(view)}>{view.name}</button>
            <button type="button" aria-label={t('outlineRemoveSavedView', { name: view.name })} title={t('outlineRemoveSavedView', { name: view.name })} onClick={() => removeView(view.id)}>×</button>
          </span>
        ))}
        {hasActiveFilter && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input
            value={newViewName}
            onChange={(event) => setNewViewName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') saveCurrentView(); }}
            placeholder={t('outlineSaveViewPlaceholder')}
            aria-label={t('outlineSaveViewPlaceholder')}
            className={styles.panelSearch}
          />
          <button type="button" disabled={!newViewName.trim()} onClick={saveCurrentView}>{t('outlineSaveView')}</button>
        </span>}
      </div>}
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
