'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

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
      <div style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** Muted inline text — the canonical loading / error / empty-state line for a widget body. */
export function WidgetMuted({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{children}</span>;
}

/**
 * The pre-data body of a widget: its error line, its loading line, or `null` once
 * the source has resolved. Every widget module had re-inlined the identical
 * ternary (`error ? <Muted>{error}</Muted> : data == null ? <Muted>loading</Muted>
 * : null`), which is how a widget could end up reporting a failed read as an
 * empty chart. One place decides, so every widget says the same thing.
 *
 * Returns `null` when there is data — the caller then renders its own body:
 *
 *   const src = useDora(days);
 *   const state = useSourceState(src);
 *   if (!src.data) return state;
 */
export function useSourceState(source: { data: unknown; error: string | null }): ReactNode {
  const t = useTranslations('widgets');
  if (source.error) return <WidgetMuted>{source.error}</WidgetMuted>;
  if (source.data == null) return <WidgetMuted>{t('loading')}</WidgetMuted>;
  return null;
}
