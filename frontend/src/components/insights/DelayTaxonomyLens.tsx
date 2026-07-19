'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { empInsightsApi, type DelayTaxonomyResult } from '@/lib/empInsightsApi';
import { usePmData } from '@/lib/pm/usePmData';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { DonutChart, type DonutSegment } from '@/components/charts/DonutChart';
import { colorAt } from '@/components/charts/chartColors';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { DaysWindowSelect } from './LensShell';

/**
 * LENS — Delay root-cause taxonomy (EMP-9). A donut of WHY work stalled (blended
 * manual tags + auto-inferred stalls) plus a table with the manual/inferred split
 * and average worst-stall dwell per reason.
 */
export function DelayTaxonomyLens() {
  const t = useTranslations('insights.emp');
  const { currentProjectId } = useProjectScope();
  const [days, setDays] = useState(90);
  const { data, error } = usePmData<DelayTaxonomyResult>(() => empInsightsApi.delayTaxonomy(days, currentProjectId), [days, currentProjectId]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const segments: DonutSegment[] = data.reasons.map((r, i) => ({
    key: r.reasonCode,
    label: t(`delay.reason.${r.reasonCode}`),
    value: r.taskCount,
    color: colorAt(i),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <StatCard label={t('delay.taggedTasks')} value={String(data.taggedTasks)} />
        <StatCard label={t('delay.manual')} value={String(data.manualTags)} />
        <StatCard label={t('delay.inferred')} value={String(data.inferredTasks)} />
      </div>

      <PmCard title={t('delay.distribution')}>
        {segments.length ? (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <DonutChart
              segments={segments}
              centerValue={String(data.taggedTasks)}
              centerLabel={t('delay.tasks')}
              ariaLabel={t('delay.distribution')}
            />
          </div>
        ) : (
          <PmEmpty message={t('delay.noData')} />
        )}
      </PmCard>

      {data.reasons.length > 0 && (
        <PmCard title={t('delay.tableTitle')}>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('delay.reasonCol')}</th>
                  <th style={thStyle}>{t('delay.tasks')}</th>
                  <th style={thStyle}>{t('delay.manual')}</th>
                  <th style={thStyle}>{t('delay.inferred')}</th>
                  <th style={thStyle}>{t('delay.avgDwell')}</th>
                </tr>
              </thead>
              <tbody>
                {data.reasons.map((r) => (
                  <tr key={r.reasonCode} style={trStyle}>
                    <td style={tdStyle}>{t(`delay.reason.${r.reasonCode}`)}</td>
                    <td style={tdMutedStyle}>{r.taskCount}</td>
                    <td style={tdMutedStyle}>{r.manualCount}</td>
                    <td style={tdMutedStyle}>{r.inferredCount}</td>
                    <td style={tdMutedStyle}>{r.avgDwellHours == null ? '—' : `${r.avgDwellHours.toFixed(1)}h`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 12 }}>{t('delay.footnote')}</p>
        </PmCard>
      )}
    </div>
  );
}
