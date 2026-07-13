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

function pillStyle(active: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '7px 14px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    border: `1px solid ${active ? 'var(--border-accent, var(--accent))' : 'var(--border-subtle)'}`,
    background: active ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
    color: active ? 'var(--text-strong)' : 'var(--text-secondary)',
    transition: 'color .15s, background .15s, border-color .15s',
  };
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
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 24, paddingBottom: 4, overflowX: 'auto', ...style }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <Link
            key={tab.id || 'default'}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            style={pillStyle(active)}
          >
            {tab.icon && <span aria-hidden="true" style={{ fontSize: 14 }}>{tab.icon}</span>}
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
