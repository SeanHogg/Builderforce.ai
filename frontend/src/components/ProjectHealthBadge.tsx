'use client';

import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import { trafficTier, type RawCompositeResult } from '@/lib/compositeHealth';

/** Interface for the result from a health score computation (e.g., from a data source hook). */
export interface HealthScoreComputed {
  score: number | null;
  status: HealthStatus;
  color: string | null;
  lastUpdatedAt: string | null;
  subMetrics: ReadonlyArray<{
    name: string;
    value: number;
    weight: number;
  }>;
  raw: RawCompositeResult;
  trend: 'improving' | 'degrading' | 'stable' | 'no_data';
  hasCriticalOverride: boolean;
}

/** Wrapped type for export from this file. */
export type HealthStatus = 'green' | 'amber' | 'red' | 'no_data';
type HealthTier = HealthStatus;

/** Shared health-badge visuals — the single source of truth for the health badge so surfaces don't drift. */
export interface ProjectHealthBadgeProps {
  /** The computed health data. */
  health: HealthScoreComputed;
  /** The project to bind visuals to, if needed. */
  project?: Project;
}

export function ProjectHealthBadge({ health, project }: ProjectHealthBadgeProps) {
  const t = useTranslations('projectCard');
  const tierLabel = health.status === 'no_data' ? t('tier.noData') : t(`tier.${health.status}`);

  // Accessibility: use the tier label for ariaLabel; fallback to score if available.
  const healthAria =
    health.status !== 'no_data' && health.score != null
      ? t('healthAria', { score: health.score, tier: tierLabel })
      : t('healthNoDataAria');

  // If no data (no score or no sub-metrics), show a neutral placeholder.
  if (health.status === 'no_data') {
    return (
      <div
        role="img"
        aria-label={healthAria}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600"
      >
        <span className="w-2 h-2 rounded-full bg-neutral-400" aria-hidden />
        {t('healthNoData')}
      </div>
    );
  }

  // If any sub-metric is stale, ensure the badge indicates it (parity with FR-3 AC-3).
  const hasStaleIndicator = health.subMetrics.some((m) => {
    const lastVal = new Date(health.lastUpdatedAt ?? '');
    const now = new Date();
    const isOlderThanTwoRefreshes = now.getTime() - lastVal.getTime() > 5 * 60 * 1000;
    return isOlderThanTwoRefreshes;
  });
  const staleHtml = hasStaleIndicator
    ? `<span class="text-[10px] ml-1" title="${t('staleIndicator'); ?>">⚠</span>`
    : '';

  // Tooltip content: list each sub-metric.
  const tooltipContent = health.subMetrics.length > 0 ? (
    <ul className="text-xs space-y-1">
      {health.subMetrics.map((m) => {
        const normalised = Math.min(100, Math.max(0, m.value));
        return (
          <li key={m.name} className="flex items-center justify-between">
            <span className="text-neutrals-700">{m.name}</span>
            <div className="flex items-center gap-2">
              <span className="font-medium text-neutrals-700">{Math.round(normalised)}%</span>
              <span className="w-12 h-1 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-current shadow-sm"
                  style={{
                    width: `${normalised}%`,
                    color: health.color ?? 'var(--text-muted)',
                  }}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  ) : (
    <p className="text-xs text-neutrals-500">{t('noBreakdown')}</p>
  );

  return (
    <div
      className="relative inline-flex items-center justify-between rounded-full border px-2.5 py-0.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      role="img"
      aria-label={healthAria}
      style={{
        borderColor: health.color ?? 'var(--border-subtle)',
        backgroundColor: health.color
          ? `${health.color}12` // 12 is 12/255 ~ 4.7% opacity (very subtle tint).
          : 'var(--bg-base)',
      }}
    >
      {/* Show score, tier label, and an optional stale indicator. */}
      {(health.score ?? health.trend ?? '') != null && health.status !== 'no_data' ? (
        <span className="text-xs font-semibold text-current" style={{ color: health.color }}>
          {health.score != null ? health.score : '—'}
        </span>
      ) : null}

      <span
        className={`text-[10px] font-medium ${
          health.score == null ? 'text-neutrals-500' : 'text-neutrals-700'
        }`}
      >
        {tierLabel}
      </span>
      {staleHtml}

      {/* Visual-only tooltip饼. */}
      <div
        className="absolute z-50 max-w-xs rounded-lg border px-3 py-2 text-xs bg-neutrals-900 text-white shadow-xl opacity-0 transition-opacity pointer-events-none group-hover:opacity-100"
        style={{
          left: 'calc(100% + 8px)',
          top: '50%',
          transform: 'translateY(-50%)',
        }}
      >
        <div className="flex items-center justify-between mb-1 border-b border-white/10 pb-1">
          <span className="font-semibold text-[10px] text-neutrals-300">
            {t('breakdownTitle')}
          </span>
          <span className="text-[10px] text-neutrals-400">{t('lastUpdated')}: {new Date(health.lastUpdatedAt ?? '').toLocaleDateString()}</span>
        </div>
        {tooltipContent}
        {health.raw.totalWeight > 0 ? (
          <div className="mt-2 pt-1 border-t border-white/10 text-[10px] text-neutrals-400">
            <span className="font-medium">{t('totalWeight')}: </span>
            {Math.round(health.raw.totalWeight)}%
          </div>
        ) : null}
      </div>
    </div>
  );
}