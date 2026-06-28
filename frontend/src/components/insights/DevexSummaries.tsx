'use client';

import { useTranslations } from 'next-intl';
import {
  devexApi, type DevexInsights, type DevexTemplate, type DevexCampaign,
} from '@/lib/devexApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { KpiGrid } from './LensShell';
import { pct, score2, int } from './format';

/**
 * Compact "at-a-glance" summaries for the DevEx hub dashboard.
 *
 * Each summary reads the SAME source its full drill-down lens reads (so the
 * headline numbers always agree) and renders only the KPI row — the full
 * breakdown lives in the slide-out. Kept tiny + self-contained so the dashboard
 * cards AND the Brain's slide-out can compose them without prop drilling.
 * Strings live under the `insights` (results) and `surveys` (management)
 * namespaces, reused from the lenses they summarise.
 */

export function DevexResultsSummary({ days }: { days: number }) {
  const t = useTranslations('insights');
  const { data, error } = usePmData<DevexInsights>(() => devexApi.insights(days, 75), [days]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  return (
    <KpiGrid>
      <StatCard label={t('devex.index')} value={int(data.index.score)} sub={t('days', { n: data.windowDays })} />
      <StatCard label={t('devex.responseRate')} value={pct(data.responseRatePct)} sub={t('devex.responseRateSub')} />
      <StatCard label={t('devex.enps')} value={score2(data.enps)} sub={t('devex.enpsSub')} />
      <StatCard label={t('devex.aiScore')} value={score2(data.aiToolsSentiment.avgScore)} sub={t('devex.aiScoreSub')} />
    </KpiGrid>
  );
}

export function DevexSurveysSummary(_props: { days: number }) {
  const t = useTranslations('insights.devexhub');
  const { data: templates, error: tErr } = usePmData<DevexTemplate[]>(() => devexApi.templates.list(), []);
  const { data: campaigns, error: cErr } = usePmData<DevexCampaign[]>(() => devexApi.campaigns.list(), []);

  const err = tErr ?? cErr;
  if (err) return <PmError message={err} />;
  if (!templates || !campaigns) return <PmEmpty message={t('loading')} />;

  const openCampaigns = campaigns.filter((c) => c.status === 'open').length;
  const totalResponses = campaigns.reduce((acc, c) => acc + (c.responseCount ?? 0), 0);

  return (
    <KpiGrid>
      <StatCard label={t('summary.templates')} value={int(templates.length)} sub={t('summary.templatesSub')} />
      <StatCard label={t('summary.openCampaigns')} value={int(openCampaigns)} sub={t('summary.campaignsSub', { n: campaigns.length })} />
      <StatCard label={t('summary.responses')} value={int(totalResponses)} sub={t('summary.responsesSub')} />
    </KpiGrid>
  );
}
