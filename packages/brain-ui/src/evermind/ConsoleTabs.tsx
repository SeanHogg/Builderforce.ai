/**
 * <ConsoleTabs> — the tab strip for the Evermind console.
 *
 * The console's four working surfaces (teach / test / check / maintain) were stacked
 * vertically, which made the panel a scroll marathon in which "Replace the model" sat
 * a page and a half below the state it was meant to repair. They are four separate
 * JOBS on the same model, not four steps of one — so they get four tabs.
 *
 * The always-true state (version, learned count, quarantine, the on/off switches)
 * stays OUTSIDE the strip: it is the context every tab is read against, and hiding it
 * behind a tab would mean an operator could be replacing a model without seeing that
 * it is quarantined.
 *
 * A tab can carry a badge, which is how a failing readiness check stays visible from
 * the other three tabs — a refusal you can only see while standing on the tab that
 * found it is a refusal you will forget.
 *
 * Full ARIA tab semantics with roving arrow-key focus, because a tab strip that is
 * only clickable is a regression against the stacked layout it replaces.
 */
import { useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { C } from './consoleStyles';

export interface ConsoleTab {
  /** Stable id — also the state key the console persists selection under. */
  id: string;
  label: string;
  /** Optional count/marker shown on the tab (e.g. "2" findings, "!" refused). */
  badge?: string;
  /** How the badge reads: a problem, or neutral information. */
  badgeTone?: 'bad' | 'info';
  content: ReactNode;
}

export interface ConsoleTabsProps {
  tabs: ConsoleTab[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Accessible name for the strip (localized by the host). */
  label: string;
  /** Namespace for the generated ids, so two consoles on one page never collide. */
  idPrefix: string;
}

export function ConsoleTabs({ tabs, activeId, onSelect, label, idPrefix }: ConsoleTabsProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Roving focus: Left/Right move between tabs, Home/End jump to the ends. Selection
  // follows focus (the standard automatic-activation pattern) — each panel is already
  // rendered client-side, so there is no cost to activating as you arrow through.
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === activeId);
    const last = tabs.length - 1;
    const next =
      e.key === 'Home' ? 0
        : e.key === 'End' ? last
          : e.key === 'ArrowLeft' ? (i <= 0 ? last : i - 1)
            : (i >= last ? 0 : i + 1);
    const target = tabs[next];
    if (!target) return;
    onSelect(target.id);
    // Attribute selector, not `#id` — an id fragment only has to be unique, it does not
    // have to be a valid CSS identifier.
    stripRef.current?.querySelector<HTMLButtonElement>(`[id="${idPrefix}-tab-${target.id}"]`)?.focus();
  }, [activeId, idPrefix, onSelect, tabs]);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        ref={stripRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        // Wraps rather than scrolls: the VS Code sidebar is routinely under 320px, and
        // a tab you have to scroll sideways to discover is a tab nobody finds.
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 4,
          borderBottom: `1px solid ${C.border}`, paddingBottom: 0, marginTop: 2,
        }}
      >
        {tabs.map((tab) => {
          const selected = tab.id === active?.id;
          return (
            <button
              key={tab.id}
              id={`${idPrefix}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 12px', fontSize: '0.79rem', fontWeight: selected ? 700 : 600,
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: selected ? C.accent : C.text2,
                // The active marker is a bottom rule flush with the strip's own border,
                // so the selected tab reads as attached to its panel in both themes
                // without depending on a filled background colour.
                boxShadow: selected ? `inset 0 -2px 0 0 ${C.accent}` : 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
              {tab.badge && (
                <span
                  aria-hidden
                  style={{
                    fontSize: '0.62rem', fontWeight: 700, lineHeight: 1.6,
                    minWidth: 16, textAlign: 'center', padding: '0 5px', borderRadius: 999,
                    color: tab.badgeTone === 'bad' ? C.danger : C.text2,
                    border: `1px solid ${tab.badgeTone === 'bad' ? C.danger : C.border}`,
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active && (
        <div
          id={`${idPrefix}-panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`${idPrefix}-tab-${active.id}`}
          tabIndex={0}
          style={{ display: 'flex', flexDirection: 'column', gap: 10, outline: 'none' }}
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
