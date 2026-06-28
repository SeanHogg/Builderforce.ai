'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  devexApi, DEVEX_DIMENSIONS,
  type DevexInsights, type DevexDimension, type BenchmarkPercentile,
} from '@/lib/devexApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { DaysWindowSelect, KpiGrid } from './LensShell';
import { pct, score2, int } from './format';
import {
  DevexIndexCard, TopicTable, SegmentHeatmap, ParticipationChart,
  ParticipationBySegment, PrioritiesSlope, BenchmarkModal, fmtDuration,
} from './devexCharts';

const PERCENTILE_KEY = 'devex.benchmarkPercentile';

function loadPercentile(): BenchmarkPercentile {
  if (typeof window === 'undefined') return 75;
  const raw = Number(window.localStorage.getItem(PERCENTILE_KEY));
  return raw === 50 || raw === 90 ? raw : 75;
}

/**
 * DevEx Surveys & Insights lens (gate insights.devex) — the full results surface:
 * the DevEx Index, per-topic scores with trend/benchmark/sentiment, the segment
 * heatmap, participation over time + by segment, and the priorities slope chart.
 * Benchmark percentile is a persisted view preference (localStorage).
 */
export function DevexLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(90);
  const [percentile, setPercentile] = useState<BenchmarkPercentile>(75);
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);

  useEffect(() => { setPercentile(loadPercentile()); }, []);

  const { data, error } = usePmData<DevexInsights>(() => devexApi.insights(days, percentile), [days, percentile]);

  const dimLabel = useMemo(() => (d: DevexDimension) => t(`devex.dim.${d}`), [t]);

  const applyPercentile = (p: BenchmarkPercentile) => {
    setPercentile(p);
    if (typeof window !== 'undefined') window.localStorage.setItem(PERCENTILE_KEY, String(p));
    setBenchmarkOpen(false);
  };

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  // Heatmap / slope columns: a stable dimension order, restricted to those scored.
  const scoredDims = new Set(data.byDimension.map((d) => d.dimension));
  const heatmapColumns = DEVEX_DIMENSIONS.filter((d) => scoredDims.has(d));
  const slopeDims = DEVEX_DIMENSIONS.filter((d) => data.dimensionTrend.some((p) => p.ranks[d] != null));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          type="button" onClick={() => setBenchmarkOpen(true)}
          style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem', cursor: 'pointer' }}
        >
          🎯 {t('devex.benchmarkButton', { n: percentile })}
        </button>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>

      <DevexIndexCard
        score={data.index.score}
        trendDelta={data.index.trendDelta}
        benchmarkDelta={data.index.benchmarkDelta}
        percentile={percentile}
      />

      <KpiGrid>
        <StatCard label={t('devex.responseRate')} value={pct(data.responseRatePct)} sub={data.totalRecipients != null ? t('devex.ofRecipients', { n: data.totalRecipients }) : t('devex.responseRateSub')} />
        <StatCard label={t('devex.responses')} value={int(data.totalResponses)} sub={t('days', { n: data.windowDays })} />
        <StatCard label={t('devex.avgResponseTime')} value={fmtDuration(data.avgResponseTimeSec)} sub={t('devex.avgResponseTimeSub')} />
        <StatCard label={t('devex.enps')} value={score2(data.enps)} sub={t('devex.enpsSub')} />
        <StatCard label={t('devex.aiScore')} value={score2(data.aiToolsSentiment.avgScore)} sub={t('devex.aiScoreSub')} />
        <StatCard label={t('devex.aiPositive')} value={pct(data.aiToolsSentiment.positivePct)} sub={t('devex.aiPositiveSub', { n: data.aiToolsSentiment.n })} />
      </KpiGrid>

      <PmCard title={t('devex.topicsTitle')}>
        <TopicTable rows={data.byDimension} dimLabel={dimLabel} />
      </PmCard>

      <SegmentHeatmap
        byKind={data.segments.byKind}
        everyone={data.byDimension}
        columns={heatmapColumns}
        threshold={data.segments.threshold}
        dimLabel={dimLabel}
      />

      <PmCard title={t('devex.participationTitle')}>
        <ParticipationChart timeline={data.participation.timeline} />
      </PmCard>

      <ParticipationBySegment bySegment={data.participation.bySegment} />

      <PmCard title={t('devex.prioritiesTitle')}>
        <PrioritiesSlope points={data.dimensionTrend} dimensions={slopeDims} dimLabel={dimLabel} />
      </PmCard>

      {benchmarkOpen && (
        <BenchmarkModal
          percentile={percentile}
          companies={data.benchmark?.companies ?? 0}
          onApply={applyPercentile}
          onClose={() => setBenchmarkOpen(false)}
        />
      )}
    </div>
  );
}
