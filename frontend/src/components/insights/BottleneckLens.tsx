'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { insightsApi, type BottleneckInsights } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { DaysWindowSelect, KpiGrid } from './LensShell';
import { hrs, int, pct } from './format';

/**
 * BOTTLENECK ANALYSIS lens — pinpoints WHICH SDLC stage stalls work and WHY:
 * time-in-status per stage, the slowest stage (the bottleneck), rework/reopen
 * loops, and the currently-aging WIP that needs unsticking now.
 */
export function BottleneckLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  const { data, error } = usePmData<BottleneckInsights>(() => insightsApi.bottlenecks(days), [days]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><DaysWindowSelect value={days} onChange={setDays} /></div>

      <KpiGrid>
        <StatCard
          label={t('bottleneck.slowest')}
          value={data.slowestStage ? data.slowestStage.stage : '—'}
          sub={data.slowestStage ? hrs(data.slowestStage.avgHours) : t('bottleneck.noData')}
        />
        <StatCard label={t('bottleneck.reworkRate')} value={pct(data.rework.reworkRate * 100)} sub={t('bottleneck.reworkSub', { n: data.rework.reworkedTasks })} />
        <StatCard label={t('bottleneck.reopens')} value={int(data.rework.totalReopens)} sub={t('bottleneck.redos', { n: data.rework.totalRedos })} />
        <StatCard label={t('bottleneck.stuck')} value={int(data.agingWip.stuckCount)} sub={t('bottleneck.stuckSub', { n: data.agingWip.thresholdHours })} />
        <StatCard label={t('bottleneck.sample')} value={int(data.sampleSize)} sub={t('days', { n: data.windowDays })} />
      </KpiGrid>

      {/* Time-in-status per stage, slowest first */}
      <section>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '6px 0 10px' }}>{t('bottleneck.byStageTitle')}</h2>
        {data.byStage.length === 0 ? (
          <PmEmpty message={t('bottleneck.noStages')} />
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thLeft}>{t('bottleneck.stage')}</th>
                <th style={thRight}>{t('bottleneck.avgHrs')}</th>
                <th style={thRight}>{t('bottleneck.medianHrs')}</th>
                <th style={thRight}>{t('bottleneck.tasks')}</th>
              </tr>
            </thead>
            <tbody>
              {data.byStage.map((s) => (
                <tr key={s.stage}>
                  <td style={tdLeft}>{s.stage}</td>
                  <td style={tdRight}>{hrs(s.avgHours)}</td>
                  <td style={tdRight}>{hrs(s.medianHours)}</td>
                  <td style={tdRight}>{int(s.taskCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Aging WIP — the actionable "unstick these now" list */}
      <section>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '6px 0 10px' }}>{t('bottleneck.agingTitle')}</h2>
        {data.agingWip.oldest.length === 0 ? (
          <PmEmpty message={t('bottleneck.noAging')} />
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thLeft}>{t('bottleneck.key')}</th>
                <th style={thLeft}>{t('bottleneck.title')}</th>
                <th style={thLeft}>{t('bottleneck.status')}</th>
                <th style={thRight}>{t('bottleneck.age')}</th>
              </tr>
            </thead>
            <tbody>
              {data.agingWip.oldest.map((a) => (
                <tr key={a.taskId}>
                  <td style={tdLeft}>{a.key}</td>
                  <td style={tdLeft}>{a.title}</td>
                  <td style={tdLeft}>{a.status}</td>
                  <td style={tdRight}>{hrs(a.ageHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem',
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden',
};
const thBase: React.CSSProperties = {
  padding: '10px 14px', fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-subtle)', textTransform: 'uppercase', letterSpacing: '0.03em',
};
const thLeft: React.CSSProperties = { ...thBase, textAlign: 'left' };
const thRight: React.CSSProperties = { ...thBase, textAlign: 'right' };
const tdBase: React.CSSProperties = { padding: '9px 14px', borderBottom: '1px solid var(--border-subtle)' };
const tdLeft: React.CSSProperties = { ...tdBase, textAlign: 'left' };
const tdRight: React.CSSProperties = { ...tdBase, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
