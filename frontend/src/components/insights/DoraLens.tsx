'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { insightsApi, type DoraInsights } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { DaysWindowSelect, KpiGrid } from './LensShell';
import { hrs, pct } from './format';

/** LENS #2 — DORA four-keys over deployment_events (+ task lead time). */
export function DoraLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  const { data, error } = usePmData<DoraInsights>(() => insightsApi.dora(days), [days]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><DaysWindowSelect value={days} onChange={setDays} /></div>
      <KpiGrid>
        <StatCard label={t('dora.deployFreq')} value={`${data.deploymentFrequencyPerDay.toFixed(2)}/day`} sub={t('dora.deploys', { n: data.totalDeployments })} />
        <StatCard label={t('dora.leadTime')} value={hrs(data.leadTimeHours)} sub={t('dora.leadSub')} />
        <StatCard label={t('dora.cfr')} value={pct(data.changeFailureRatePct)} sub={t('dora.cfrSub')} />
        <StatCard label={t('dora.mttr')} value={hrs(data.mttrHours)} sub={t('dora.mttrSub')} />
        <StatCard label={t('dora.totalDeploys')} value={String(data.totalDeployments)} sub={t('days', { n: data.windowDays })} />
      </KpiGrid>
    </div>
  );
}
