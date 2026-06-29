'use client';

import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/types';
import { computeProjectHealth } from '@/lib/projectHealth';
import { GaugeChart } from '@/components/charts/GaugeChart';
import { DonutChart } from '@/components/charts/DonutChart';

/**
 * Shared project-health visuals — the single source of truth for the health
 * speedometer + "% done" ring so every surface (card, details panel, list)
 * renders the SAME numbers and colours from {@link computeProjectHealth}. Two
 * shapes:
 *  - {@link ProjectHealthGauges}: the full Gauge + Donut block (project card,
 *    details panel Overview).
 *  - {@link ProjectHealthBadge}: a compact inline chip + progress bar for dense
 *    surfaces (the List view table).
 * Both return null when the project has no task data so callers never special-case it.
 */

export interface ProjectHealthGaugesProps {
  project: Project;
  /** Gauge diameter in px (donut scales with it). Defaults to the card size. */
  size?: number;
}

export function ProjectHealthGauges({ project, size = 104 }: ProjectHealthGaugesProps) {
  const t = useTranslations('projectCard');
  const health = computeProjectHealth(project);
  if (!health.hasData) return null;

  const donutSize = Math.round(size * 0.8);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 12,
        padding: '10px 8px', margin: '2px 0 4px',
        background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 10,
      }}
    >
      <GaugeChart
        value={health.healthScore}
        color={health.color}
        size={size}
        centerValue={String(health.healthScore)}
        centerLabel={t('health')}
        ariaLabel={t('healthAria', { score: health.healthScore, tier: t(`tier.${health.tier}`) })}
      />
      <DonutChart
        size={donutSize}
        thickness={12}
        legend={false}
        centerValue={`${health.progressPct}%`}
        centerLabel={t('done')}
        ariaLabel={t('doneAria', { pct: health.progressPct, completed: health.completed, total: health.total })}
        segments={[
          { key: 'done', label: t('done'), value: health.completed, color: 'var(--accent)' },
          { key: 'remaining', label: t('remaining'), value: Math.max(0, health.total - health.completed), color: 'var(--border-subtle)' },
        ]}
      />
    </div>
  );
}

export interface ProjectHealthBadgeProps {
  project: Project;
}

/**
 * Compact health readout for dense rows: a tier-coloured "Health NN" chip and a
 * slim progress bar with "% done". Reuses {@link computeProjectHealth} so it can
 * never drift from the gauges. Renders a muted dash when there's no task data.
 */
export function ProjectHealthBadge({ project }: ProjectHealthBadgeProps) {
  const t = useTranslations('projectCard');
  const health = computeProjectHealth(project);
  if (!health.hasData) {
    return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 120 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          title={t('healthAria', { score: health.healthScore, tier: t(`tier.${health.tier}`) })}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 700, color: health.color,
            background: 'var(--bg-base)', border: `1px solid ${health.color}`,
            borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: health.color, flexShrink: 0 }} aria-hidden />
          {health.healthScore}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {t('tier.' + health.tier)}
        </span>
      </div>
      <div
        title={t('doneAria', { pct: health.progressPct, completed: health.completed, total: health.total })}
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--border-subtle)', overflow: 'hidden', minWidth: 48 }}>
          <div style={{ width: `${health.progressPct}%`, height: '100%', background: 'var(--accent)', borderRadius: 999 }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {t('donePct', { pct: health.progressPct })}
        </span>
      </div>
    </div>
  );
}
