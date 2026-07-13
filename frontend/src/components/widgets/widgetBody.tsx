'use client';

import type { ReactNode } from 'react';

/**
 * Shared presentational bodies for registry widgets.
 *
 * Every widget {@link WidgetDef.Card} renders ONLY its body inside the
 * {@link WidgetCard} chrome (frame/title/pin). The big-number stat and the muted
 * loading/error/empty line were copy-pasted into every widget module
 * (aiImpact/delivery/finance/core/catalog) — these are the single source so the
 * bodies read identically wherever a widget appears. For the full metric card
 * with sparkline/delta/recency, use `@/components/dashboard` `InsightStat`; this
 * is the frameless variant the chrome wraps.
 */

/** A big-number stat with an optional sub-caption. Frameless (the chrome owns the frame). */
export function WidgetStat({ value, sub }: { value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: '1.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** Muted inline text — the canonical loading / error / empty-state line for a widget body. */
export function WidgetMuted({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{children}</span>;
}
