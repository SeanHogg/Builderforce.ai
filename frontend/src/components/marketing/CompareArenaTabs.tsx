'use client';

/**
 * The arena switcher on `/compare`.
 *
 * `/compare` compares Builderforce.ai in more than one market — coding agents,
 * trackers, canvases, automation builders, gateways, marketplaces — and a
 * visitor arrives shopping in exactly one of them. The tabs are that choice.
 *
 * Every panel is RENDERED, and the inactive ones are hidden with the `hidden`
 * attribute rather than dropped from the tree. That is deliberate: the panels
 * are server-rendered comparison tables and this page is a crawl target, so all
 * six arenas have to be in the HTML a crawler receives. Conditional rendering
 * would leave five of the six markets invisible to search and to a reader with
 * JavaScript disabled — the tab strip would be the only thing that worked.
 *
 * Panels arrive as a `ReactNode[]` prop from the server component, so the whole
 * matrix stays a server render; the client owns nothing but which index shows.
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import styles from './CompareArenaTabs.module.css';

export interface CompareArenaTab {
  /** Stable arena key from `COMPARE_ARENAS`. */
  key: string;
  /** Localized tab label. */
  label: string;
  /** Localized one-line description of what this arena compares. */
  blurb: string;
}

export default function CompareArenaTabs({
  tabs,
  panels,
  label,
}: {
  tabs: CompareArenaTab[];
  /** One panel per tab, in the same order. */
  panels: ReactNode[];
  /** Accessible name for the tab strip. */
  label: string;
}) {
  const baseId = useId();
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  if (!tabs.length) return null;

  const tabId = (index: number) => `${baseId}-tab-${tabs[index].key}`;
  const panelId = (index: number) => `${baseId}-panel-${tabs[index].key}`;

  // The ARIA tabs pattern: arrows move AND select, Home/End jump to the ends.
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    buttons.current[next]?.focus();
  };

  return (
    <>
      <div className={styles.wrap}>
        <div className={styles.list} role="tablist" aria-label={label}>
          {tabs.map((tab, index) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={tabId(index)}
              // A stable hook for the ARENA, so a test targets what the tab
              // selects rather than the words it says in one locale.
              data-arena={tab.key}
              className={styles.tab}
              aria-selected={index === active}
              aria-controls={panelId(index)}
              tabIndex={index === active ? 0 : -1}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className={styles.blurb}>{tabs[active].blurb}</p>
      </div>

      {tabs.map((tab, index) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={panelId(index)}
          aria-labelledby={tabId(index)}
          className={styles.panel}
          hidden={index !== active}
          tabIndex={0}
        >
          {panels[index]}
        </div>
      ))}
    </>
  );
}
