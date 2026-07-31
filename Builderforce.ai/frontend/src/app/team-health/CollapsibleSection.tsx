'use client';

/**
 * CollapsibleSection — shared UI for all four panels.
 * `badge` is an optional counter; `badgeTone` controls its colour.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  badge?: string;
  badgeTone?: 'ok' | 'warning' | 'critical';
  children: ReactNode;
  actions?: ReactNode;
}

export function CollapsibleSection({ title, badge, badgeTone = 'ok', children, actions }: Props) {
  const [open, setOpen] = useState(true);

  const badgeColor =
    badgeTone === 'critical'
      ? 'var(--th-blocker)'
      : badgeTone === 'warning'
        ? 'var(--th-aging)'
        : 'var(--th-ok)';

  return (
    <section className="th-section">
      <button
        type="button"
        className="th-section-header"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="th-section-caret">{open ? '▾' : '▸'}</span>
        <h2 className="th-section-title">{title}</h2>
        {badge !== undefined && (
          <span
            className="th-section-badge"
            style={{
              background: `${badgeColor}22`,
              color: badgeColor,
            }}
          >
            {badge}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {actions}
      </button>
      {open && <div className="th-section-body">{children}</div>}
    </section>
  );
}
