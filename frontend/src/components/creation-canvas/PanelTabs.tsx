'use client';

/**
 * The tab strip a canvas side panel switches its mode with.
 *
 * Two panels had hand-written this — the same `role="tablist"`, the same three buttons,
 * the same `aria-selected` — and both were WRONG in the same way: the stylesheet keys
 * the selected pill on `[aria-pressed='true']`, which a tab never sets, so neither panel
 * showed which of its tabs you were on. Two copies of a markup contract, one copy of the
 * style that answers it, and nothing to tell them they disagreed.
 *
 * So the markup is declared once, here, next to a rule that now matches it. A third
 * panel gets the highlight for free instead of inheriting the bug.
 *
 * `role="tab"` also carries a keyboard contract, honoured here rather than left to each
 * panel: arrow keys move between tabs, Home and End jump to the ends, and only the
 * selected tab is in the page's tab order — a strip of N buttons that each take a Tab
 * press is not a tablist, it is a toolbar wearing its name.
 */

import { useRef } from 'react';
import styles from './CreationCanvas.module.css';

export interface PanelTab<T extends string> {
  id: T;
  /** Already localized — this component renders words, it does not choose them. */
  label: string;
}

export interface PanelTabsProps<T extends string> {
  tabs: ReadonlyArray<PanelTab<T>>;
  value: T;
  onChange: (next: T) => void;
  /** Names the strip for a screen reader — usually the panel's own title. */
  label: string;
}

export function PanelTabs<T extends string>({ tabs, value, onChange, label }: PanelTabsProps<T>) {
  const strip = useRef<HTMLDivElement>(null);

  const move = (index: number, delta: number) => {
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.id);
    // Focus follows selection, which is the automatic-activation pattern a two- or
    // three-tab strip wants: the panel's content changes with the arrow key, so leaving
    // focus behind would read the old tab's name over the new tab's content.
    strip.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <div className={styles.driveAccounts} role="tablist" aria-label={label} ref={strip}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          data-tab={tab.id}
          aria-selected={value === tab.id}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(index, 1); }
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(index, -1); }
            else if (event.key === 'Home') { event.preventDefault(); move(0, 0); }
            else if (event.key === 'End') { event.preventDefault(); move(tabs.length - 1, 0); }
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
