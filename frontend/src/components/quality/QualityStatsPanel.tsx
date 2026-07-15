'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { qualityApi, type QualityStats } from '@/lib/builderforceApi';
import { TrendChart } from '@/components/charts/TrendChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart } from '@/components/charts/BarChart';
import { levelColor, statusColor, sourceColor } from './qualityColors';

/**
 * Data-driven Quality overview — the "what have we collected, and what is it
 * telling us?" panel. Self-fetching off the cached /api/quality/stats aggregate
 * (project-scoped or tenant-wide), it renders the volume collected, the daily
 * frequency trend, and breakdowns by error level / type / collector. It is the
 * analytics half of the Errors tab; billed month-to-date consumption is rendered
 * separately by the reusable Errors allowance meter.
 */
export function QualityStatsPanel({ projectId, days = 30 }: { projectId?: number | null; days?: number }) {
  const t = useTranslations('quality');
  const [stats, setStats] = useState<QualityStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    qualityApi.stats(projectId, days)
      .then((s) => { if (active) setStats(s); })
      .catch(() => { if (active) setStats(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, days]);

  if (loading) return <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</div>;
  if (!stats || stats.totals.events === 0) {
    return <div style={{ ...card, color: 'var(--text-muted)', fontSize: 13 }}>{t('stats.empty')}</div>;
  }

  const levelSegments = stats.byLevel
    .filter((l) => l.events > 0)
    .map((l) => ({ key: l.level, label: t(`level.${l.level}`), value: l.events, color: levelColor(l.level) }));
  const statusSegments = stats.byStatus
    .filter((s) => s.groups > 0)
    .map((s) => ({ key: s.status, label: t(`status.${s.status}`), value: s.groups, color: statusColor(s.status) }));
  const collectorBars = stats.byCollector
    .filter((c) => c.events > 0)
    .sort((a, b) => b.events - a.events)
    .map((c) => ({ key: c.collectorId ?? 'unassigned', label: c.name ?? t('stats.unassigned'), value: c.events }));
  const sourceSegments = (stats.bySource ?? [])
    .filter((s) => s.events > 0)
    .sort((a, b) => b.events - a.events)
    .map((s) => ({ key: s.source, label: t(`source.${s.source}`), value: s.events, color: sourceColor(s.source) }));
  const sourceTotal = sourceSegments.reduce((sum, s) => sum + s.value, 0);

  const trendLabels = stats.daily.map((d) => d.day.slice(5)); // MM-DD
  const trendValues = stats.daily.map((d) => d.count);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Volume collected */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Stat label={t('stats.eventsCollected')} value={stats.totals.events} accent="var(--coral-bright)" />
        <Stat label={t('summary.groups')} value={stats.totals.groups} />
        <Stat label={t('summary.users')} value={stats.totals.users} />
        <Stat label={t('stats.windowDays')} value={stats.windowDays} suffix="d" />
      </div>

      {/* Frequency over time */}
      {trendValues.some((v) => v > 0) && (
        <div style={card}>
          <SectionTitle>{t('stats.frequency')}</SectionTitle>
          <TrendChart
            labels={trendLabels}
            series={[{ key: 'events', label: t('stats.eventsCollected'), values: trendValues, color: 'var(--coral-bright)' }]}
            height={150}
            area
            ariaLabel={t('stats.frequency')}
          />
        </div>
      )}

      {/* Breakdowns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        {levelSegments.length > 0 && (
          <div style={card}>
            <SectionTitle>{t('stats.byLevel')}</SectionTitle>
            <DonutChart
              segments={levelSegments}
              size={150}
              centerValue={String(stats.totals.events)}
              centerLabel={t('stats.events')}
              ariaLabel={t('stats.byLevel')}
            />
          </div>
        )}
        {statusSegments.length > 0 && (
          <div style={card}>
            <SectionTitle>{t('stats.byStatus')}</SectionTitle>
            <DonutChart
              segments={statusSegments}
              size={150}
              centerValue={String(stats.totals.groups)}
              centerLabel={t('summary.groups')}
              ariaLabel={t('stats.byStatus')}
            />
          </div>
        )}
        {sourceSegments.length > 0 && (
          <div style={card}>
            <SectionTitle>{t('stats.bySource')}</SectionTitle>
            <DonutChart
              segments={sourceSegments}
              size={150}
              centerValue={sourceTotal.toLocaleString()}
              centerLabel={t('stats.events')}
              ariaLabel={t('stats.bySource')}
            />
          </div>
        )}
        {collectorBars.length > 0 && (
          <div style={card}>
            <SectionTitle>{t('stats.byCollector')}</SectionTitle>
            <BarChart data={collectorBars} maxRows={6} labelWidth={120} ariaLabel={t('stats.byCollector')} />
          </div>
        )}
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12 }}>{children}</div>;
}

function Stat({ label, value, accent, suffix }: { label: string; value: number; accent?: string; suffix?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? 'var(--text-primary)' }}>
        {value.toLocaleString()}{suffix ?? ''}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}
