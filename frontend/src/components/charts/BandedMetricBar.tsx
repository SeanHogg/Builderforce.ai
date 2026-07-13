'use client';

import type { CSSProperties } from 'react';

/**
 * Reusable "metric vs. qualitative tiers" bar — the project's benchmark primitive
 * (no charting lib; matches the hand-rolled DonutChart/BarChart convention). A row
 * of equal-width tier segments rendered best→worst; the tier the value falls into
 * is highlighted and the others dimmed, so a single value reads instantly against
 * an industry/benchmark scale (e.g. DORA Elite / High / Medium / Low).
 *
 * Presentation only: the caller classifies the value into `activeIndex` and
 * supplies already-localized tier labels + the formatted value text.
 */

export interface MetricTier {
  /** Stable key (also the segment key). */
  key: string;
  /** Localized tier label shown inside the segment. */
  label: string;
  /** Any CSS colour (hex or `var(--token)`). */
  color: string;
}

export interface BandedMetricBarProps {
  /** Metric name shown at the row start. */
  label: string;
  /** Already-formatted value (e.g. "0.42/day"); shown at the row end. */
  valueText: string;
  /** Tiers ordered best→worst, drawn left→right as equal segments. */
  tiers: MetricTier[];
  /** Index into `tiers` the value lands in; `null` = no data (all dimmed). */
  activeIndex: number | null;
  ariaLabel?: string;
}

const headRow: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, fontSize: '0.85rem',
};

export function BandedMetricBar({ label, valueText, tiers, activeIndex, ariaLabel }: BandedMetricBarProps) {
  const active = activeIndex != null ? tiers[activeIndex] : undefined;

  return (
    <div role="group" aria-label={ariaLabel ?? label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={headRow}>
        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {active && (
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, color: '#fff', background: active.color,
              padding: '1px 8px', borderRadius: 999,
            }}>
              {active.label}
            </span>
          )}
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{valueText}</span>
        </span>
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {tiers.map((tr, i) => {
          const on = i === activeIndex;
          return (
            <div
              key={tr.key}
              title={tr.label}
              style={{
                flex: 1, height: 22, borderRadius: 5, background: tr.color,
                opacity: activeIndex == null ? 0.4 : on ? 1 : 0.26,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                outline: on ? '2px solid var(--text-primary)' : 'none', outlineOffset: 1,
                transition: 'opacity 0.2s',
              }}
            >
              <span style={{
                fontSize: '0.68rem', fontWeight: on ? 700 : 600, color: '#fff',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 4px',
              }}>
                {tr.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
