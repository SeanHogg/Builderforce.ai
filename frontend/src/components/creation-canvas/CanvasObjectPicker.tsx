// No 'use client': rendered only inside `CreationCanvas`'s client boundary.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { CreationObjectGroup, CreationObjectKind } from './types';
import { CREATION_PALETTE_GROUPS } from './creationObjectRegistry';
import styles from './CreationCanvas.module.css';

/**
 * ONE picker, two doors.
 *
 * The board needs "choose an object" in two places that look nothing alike: the centre
 * `+` on a node (insert the next step, connected to this one) and the coloured circles on
 * the command bar (add something to the board). They are the same question, so they are
 * the same component — anchored differently and told what they are adding TO.
 *
 * The alternative, which is what the mockup review kept describing as six popovers, is a
 * hand-written module list per category. That list goes stale the first time a kind is
 * added to `creationObjectRegistry` and not to the bar, and the object then exists, is
 * authorable by Brain, and is unreachable by a person. So the contents come from
 * `CREATION_PALETTE_GROUPS` and nothing here knows any kind's name.
 *
 * ── WHY IT SEARCHES ACROSS GROUPS ────────────────────────────────────────────────
 * Opening on a category and then typing narrows the WHOLE catalogue, not the category.
 * Somebody who opens "Build" and types "invoice" wants the invoice, not an empty Build
 * list — and a picker that answers "no results" while holding the thing they asked for is
 * the single most annoying way to be wrong.
 */

export interface CanvasObjectPickerProps {
  /** Where it opens, in screen px. */
  anchor: { x: number; y: number };
  /** The group it opens on. Absent = every group, which is the bar's "all" circle. */
  group?: CreationObjectGroup;
  /**
   * The node this insert hangs off. Present when the centre `+` opened it: the chosen
   * object is created beside that node AND connected to it, which is the difference
   * between "add a step" and "add an object".
   */
  fromNodeId?: string;
  onPick: (kind: CreationObjectKind, fromNodeId?: string) => void;
  onClose: () => void;
}

export function CanvasObjectPicker({ anchor, group, fromNodeId, onPick, onClose }: CanvasObjectPickerProps) {
  const t = useTranslations('creationCanvas');
  const tPicker = useTranslations('creationCanvas.picker');
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<CreationObjectGroup | null>(group ?? null);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !ref.current?.contains(target)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // A frame later — the click that opened this is still propagating.
    const timer = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const searching = query.trim().length > 0;
  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Searching ignores the open category on purpose — see the header note.
    const source = searching || activeGroup === null
      ? CREATION_PALETTE_GROUPS
      : CREATION_PALETTE_GROUPS.filter((entry) => entry.group === activeGroup);
    return source.flatMap((entry) => entry.items
      .filter((item) => !needle || `${item.kind} ${item.label} ${entry.group}`.toLowerCase().includes(needle))
      .map((item) => ({ ...item, group: entry.group })));
  }, [activeGroup, query, searching]);

  return (
    <div
      ref={ref}
      className={styles.objectPicker}
      data-testid="canvas-object-picker"
      role="dialog"
      aria-label={fromNodeId ? tPicker('insertLabel') : tPicker('addLabel')}
      style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
    >
      <div className={styles.objectPickerSearch}>
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tPicker('search')}
          aria-label={tPicker('search')}
        />
      </div>
      <div className={styles.objectPickerRows}>
        {/* The rail is every real group, so the six circles on the bar are a shortcut
            into this and never the boundary of it. */}
        <div className={styles.objectPickerRail} role="group" aria-label={tPicker('categories')}>
          <button
            type="button"
            aria-pressed={activeGroup === null}
            onClick={() => setActiveGroup(null)}
          >{tPicker('allGroups')}</button>
          {CREATION_PALETTE_GROUPS.map((entry) => <button
            key={entry.group}
            type="button"
            aria-pressed={activeGroup === entry.group}
            onClick={() => setActiveGroup(entry.group)}
          >{t(`group.${entry.group}` as 'group.Build')}</button>)}
        </div>
        <div className={styles.objectPickerList}>
          {items.length === 0 && <p className={styles.anchoredPanelEmpty}>{tPicker('noMatches', { query: query.trim() })}</p>}
          {items.map((item) => <button
            key={`${item.group}-${item.kind}`}
            type="button"
            data-testid={`canvas-picker-${item.kind}`}
            onClick={() => onPick(item.kind, fromNodeId)}
          >
            <span className={styles.objectPickerIcon} aria-hidden><Icon source={item.icon} size={18} /></span>
            <span>
              <b>{t(`object.${item.kind}` as 'object.note')}</b>
              {/* The mockup's per-module line: what this kind actually does, not just
                  its name. Search still appends the group, because a result list that
                  spans sixteen groups is unreadable without saying which is which. */}
              <small>
                {t(`objectDescription.${item.kind}` as 'objectDescription.note')}
                {searching && <> · {t(`group.${item.group}` as 'group.Build')}</>}
              </small>
            </span>
          </button>)}
        </div>
      </div>
    </div>
  );
}
