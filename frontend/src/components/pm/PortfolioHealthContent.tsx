import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { fetchProjects } from '@/lib/api';
import { useFormat } from '@/i18n/useFormat';
import { useBrainDataRefresh } from '@/lib/brain/useBrainDataRefresh';
import { usePmData } from '@/lib/pm/usePmData';
import { buildPortfolioHealth, RAG_COLOR, type Rag } from '@/lib/pm/portfolioHealth';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { PmEmpty, PmError } from './pmShared';
import { PortfolioHealthCard } from './PortfolioHealthCard';

/**
 * Portfolio → Health — the cross-project health dashboard: one card per live project
 * with its RAG band, progress, single biggest blocker and one next action, under the
 * summary leadership reads before the fold (RAG counts, overall band, top 3 actions).
 *
 * Self-contained: it owns its read (`fetchProjects`, the same cached list the projects
 * page uses — no new endpoint and no second source of truth for project health), owns
 * its loading/empty/error states, and takes no props. It can be dropped on any surface
 * that already sits inside the portfolio capability gate.
 *
 * Scope: cross-project by definition, so it deliberately ignores the portfolio /
 * initiative scope picker — a health read that hides half the portfolio is not one.
 * Completed and archived projects are filtered out by `livePortfolioProjects`.
 *
 * No `'use client'`: the only importer is `PmoContent`, which is already a client
 * boundary (see `scripts/check-frontend-architecture.mjs`).
 */

const RAG_BANDS: Rag[] = ['red', 'amber', 'green'];

const bannerStyle = (color: string): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  padding: '12px 16px',
  background: 'var(--surface-card)',
  border: `1px solid ${color}`,
  borderRadius: 'var(--radius-lg)',
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-secondary)',
});

export function PortfolioHealthContent() {
  const t = useTranslations('pmo');
  const fmt = useFormat();
  const { data: projects, error, reload } = usePmData(() => fetchProjects(), []);
  // `fetchProjects` is read-through cached with ttlMs 0, so reload() genuinely
  // re-reads — a project created or updated in a Brain chat lands here immediately.
  useBrainDataRefresh(['projects'], reload);

  // Stamped when a fresh list settles, so "as of" tracks the data rather than the
  // clock — it is the snapshot's age, not the render's.
  const generatedAt = useMemo(() => (projects ? new Date() : null), [projects]);
  const portfolio = useMemo(() => (projects ? buildPortfolioHealth(projects) : null), [projects]);

  if (error) return <PmError message={error} />;
  if (!portfolio) return <PmEmpty message={t('loading')} />;
  if (portfolio.summary.total === 0) return <PmEmpty message={t('health.empty')} />;

  const { summary, items } = portfolio;
  const overallColor = RAG_COLOR[summary.overall];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
          {t('health.snapshotHeading')}
        </h3>
        {generatedAt && (
          <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
            {t('health.generatedAt', { when: fmt.dateTime(generatedAt) })}
          </span>
        )}
      </div>

      {/* RAG counts — the three-number read (FR-4). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {RAG_BANDS.map((band) => (
          <InsightStat
            key={band}
            label={t(`health.rag.${band}`)}
            value={String(summary[band])}
            sub={t('health.ofTotal', { total: summary.total })}
            color={RAG_COLOR[band]}
          />
        ))}
      </div>

      <div style={bannerStyle(overallColor)}>
        <span>{t('health.overallLabel')}</span>
        <strong style={{ color: overallColor, fontSize: 'var(--font-size-body)' }}>
          {t(`health.rag.${summary.overall}`)}
        </strong>
      </div>

      {summary.topActions.length > 0 && (
        <div>
          <h4 style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
            {t('health.topActionsHeading')}
          </h4>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {summary.topActions.map(({ rank, item }) => (
              <li key={rank} style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                <strong style={{ color: RAG_COLOR[item.rag] }}>{item.name}</strong>
                {' — '}
                {t(`health.action.${item.action.key}`, item.action.values)}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 12 }}>
        {items.map((item) => (
          <PortfolioHealthCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
