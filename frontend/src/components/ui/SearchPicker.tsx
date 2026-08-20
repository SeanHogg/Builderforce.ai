// No 'use client': rendered only inside its callers' own client boundaries
// (`CanvasObjectPicker.tsx`, itself inside `CreationCanvas`'s; `WorkflowNodePicker.tsx`).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * ONE searchable, anchored, categorized picker — the interaction shared by
 * "add something to the canvas" and "add a step to this workflow". Both are
 * the same question (pick one thing from a catalog grouped into families,
 * searchable across the whole catalog regardless of which family is open),
 * so the search/filter/keyboard-close/outside-click behavior lives here once.
 *
 * Presentation is NOT shared: the canvas and the workflow builder each carry
 * their own theme (the canvas deliberately owns its own palette, distinct
 * from the app shell). Callers supply `classNames` for the handful of slots
 * this renders and keep their own CSS module.
 */

export interface SearchPickerItem<K extends string> {
  kind: K;
  icon: string;
  label: string;
  description: string;
  /**
   * Shown, named, and refused.
   *
   * A catalog entry this caller may not choose is DISABLED rather than dropped, which is
   * the rule the rest of the product follows (`<RoleGate>` disables and never hides).
   * Hiding it means nobody can discover the capability, and a person who cannot see the
   * row cannot understand why the documentation mentions it — an absence is a smaller
   * product, where a refusal is a boundary. `lockedReason` becomes the tooltip, so the
   * row says WHY rather than merely being grey.
   */
  locked?: boolean;
  lockedReason?: string;
}

export interface SearchPickerSection<K extends string> {
  /** Stable identity for the rail button and the "found in Y" tag on a search hit. */
  key: string;
  label: string;
  items: SearchPickerItem<K>[];
}

export interface SearchPickerClassNames {
  root: string;
  search: string;
  close: string;
  rows: string;
  rail: string;
  list: string;
  icon: string;
  empty: string;
}

export interface SearchPickerProps<K extends string> {
  anchor: { x: number; y: number };
  sections: SearchPickerSection<K>[];
  /** Section the rail opens on. Undefined = every section. */
  initialGroupKey?: string;
  classNames: SearchPickerClassNames;
  ariaLabel: string;
  searchPlaceholder: string;
  categoriesLabel: string;
  allGroupsLabel: string;
  closeLabel: string;
  noMatches: (query: string) => string;
  /** Item `data-testid`s render as `${testIdPrefix}-${kind}`. */
  testIdPrefix: string;
  dialogTestId?: string;
  onPick: (kind: K) => void;
  onClose: () => void;
}

export function SearchPicker<K extends string>({
  anchor,
  sections,
  initialGroupKey,
  classNames,
  ariaLabel,
  searchPlaceholder,
  categoriesLabel,
  allGroupsLabel,
  closeLabel,
  noMatches,
  testIdPrefix,
  dialogTestId,
  onPick,
  onClose,
}: SearchPickerProps<K>) {
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>(initialGroupKey ?? null);
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
    // Searching ignores the open section on purpose: narrowing to "everything
    // matching X" beats answering "no results" while holding the thing asked for.
    const source = searching || activeGroup === null
      ? sections
      : sections.filter((section) => section.key === activeGroup);
    return source.flatMap((section) => section.items
      .filter((item) => !needle || `${item.kind} ${item.label} ${section.label}`.toLowerCase().includes(needle))
      .map((item) => ({ ...item, sectionKey: section.key, sectionLabel: section.label })));
  }, [activeGroup, query, searching, sections]);

  return (
    <div
      ref={ref}
      className={classNames.root}
      data-testid={dialogTestId}
      role="dialog"
      aria-label={ariaLabel}
      style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
    >
      <div className={classNames.search}>
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
        />
        <button type="button" className={classNames.close} aria-label={closeLabel} title={closeLabel} onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className={classNames.rows}>
        <div className={classNames.rail} role="group" aria-label={categoriesLabel}>
          <button type="button" aria-pressed={activeGroup === null} onClick={() => setActiveGroup(null)}>{allGroupsLabel}</button>
          {sections.map((section) => (
            <button
              key={section.key}
              type="button"
              aria-pressed={activeGroup === section.key}
              onClick={() => setActiveGroup(section.key)}
            >{section.label}</button>
          ))}
        </div>
        <div className={classNames.list}>
          {items.length === 0 && <p className={classNames.empty}>{noMatches(query.trim())}</p>}
          {items.map((item) => (
            <button
              key={`${item.sectionKey}-${item.kind}`}
              type="button"
              data-testid={`${testIdPrefix}-${item.kind}`}
              data-locked={item.locked ? 'true' : undefined}
              disabled={item.locked}
              {...(item.locked && item.lockedReason ? { title: item.lockedReason } : {})}
              onClick={() => onPick(item.kind)}
            >
              <span className={classNames.icon} aria-hidden><Icon source={item.icon} size={18} /></span>
              <span>
                <b>{item.label}</b>
                <small>
                  {item.description}
                  {searching && <> · {item.sectionLabel}</>}
                </small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
