'use client';

/**
 * Shared in-page secondary navigation: a pill / segmented tab bar rendered BELOW
 * the shell's top <SectionTabs> underline bar to break one destination's page into
 * focused sub-views (e.g. Settings → Account · Personality · Sessions · Workspace).
 *
 * Presentational only — the caller owns which tab is active and where each links.
 * Self-hides for a single tab (returns null) so callers never have to gate it.
 * This is the one place the pill look lives; AdminGroupNav and the Settings /
 * Security pages all render through it so the style never drifts.
 */

import Link from 'next/link';
import type { CSSProperties } from 'react';

export interface PillTab {
  /** Stable id used for active comparison (e.g. the `?sub=` value; '' = default). */
  id: string;
  label: string;
  icon?: string;
  href: string;
}

export default function PillTabs({
  tabs,
  activeId,
  ariaLabel,
  style,
}: {
  tabs: PillTab[];
  activeId: string;
  ariaLabel: string;
  style?: CSSProperties;
}) {
  if (tabs.length <= 1) return null;

  return (
    <nav
      aria-label={ariaLabel}
      className="pill-tabs"
      style={style}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <Link
            key={tab.id || 'default'}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`pill-tab${active ? ' is-active' : ''}`}
          >
            {tab.icon && <span aria-hidden="true" style={{ fontSize: 14 }}>{tab.icon}</span>}
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
