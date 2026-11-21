/**
 * The popup every composer trigger (`@`, `#`, `/`) shows — presentational, driven by
 * {@link useTriggerAutocomplete}. Styled by `.bf-cmp-typeahead*` in the package's
 * styles.css (theme tokens only, so it reads in the web app light/dark and in the
 * editor's active theme, and fits a narrow sidebar).
 */
import { useEffect, type ReactNode } from 'react';

export interface TriggerPopupProps<T> {
  listId: string;
  optionId: (i: number) => string;
  items: readonly T[];
  active: number;
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  isDisabled?: (item: T) => boolean;
  onHover: (i: number) => void;
  onPick: (item: T) => void;
  listLabel: string;
  heading?: string;
  emptyLabel: string;
}

export function TriggerPopup<T>(props: TriggerPopupProps<T>) {
  const { listId, optionId, items, active, itemKey, renderItem, isDisabled, onHover, onPick, listLabel, heading, emptyLabel } = props;

  // Keep the highlighted row in view as the arrows move it through a long list.
  const activeId = items.length ? optionId(active) : null;
  useEffect(() => {
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  if (items.length === 0) {
    return (
      <div className="bf-cmp-typeahead">
        <div className="bf-cmp-typeahead__empty" role="status" aria-live="polite">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div className="bf-cmp-typeahead">
      <div className="bf-cmp-typeahead__panel">
        {heading && <div className="bf-cmp-typeahead__heading" aria-hidden="true">{heading}</div>}
        <ul id={listId} role="listbox" aria-label={listLabel} className="bf-cmp-typeahead__list">
          {items.map((item, i) => {
            const disabled = isDisabled?.(item) ?? false;
            return (
              <li
                key={itemKey(item)}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                aria-disabled={disabled || undefined}
                className={['bf-cmp-typeahead__item', i === active ? 'is-active' : '', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}
                // onMouseDown (not onClick) + preventDefault so the click does not blur the
                // textarea before the pick restores its caret.
                onMouseDown={(e) => { e.preventDefault(); if (!disabled) onPick(item); }}
                onMouseEnter={() => onHover(i)}
              >
                {renderItem(item)}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
