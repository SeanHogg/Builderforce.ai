'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { recommendationsApi, type SpaceMetrics, type SpaceDimension } from '@/lib/recommendationsApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { DaysWindowSelect, KpiGrid } from './LensShell';

/**
 * SPACE metrics lens — the five-dimension developer-productivity framework that
 * complements DORA: Satisfaction, Performance, Activity, Communication &
 * collaboration, Efficiency & flow. Each is a 0..100 score with supporting figures.
 */

const fmtScore = (n: number | null): string => (n == null ? '—' : `${Math.round(n)}`);
const fmtFig = (n: number | null): string => (n == null ? '—' : n.toLocaleString());

/** camelCase / snake_case figure key → a readable label (figure keys are data-driven). */
const humanize = (k: string): string =>
  k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function SpaceLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  const { data, error } = usePmData<SpaceMetrics>(() => recommendationsApi.space(days), [days]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const dims: Array<{ id: string; score: number | null; figures: Record<string, number | null> }> = [
    { id: 'satisfaction', score: data.satisfaction.score, figures: { members: data.satisfaction.n } },
    { id: 'performance', score: data.performance.score, figures: data.performance.figures },
    { id: 'activity', score: data.activity.score, figures: data.activity.figures },
    { id: 'communication', score: data.communication.score, figures: data.communication.figures },
    { id: 'efficiency', score: data.efficiency.score, figures: data.efficiency.figures },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><DaysWindowSelect value={days} onChange={setDays} /></div>
      <KpiGrid>
        {dims.map((d) => (
          <StatCard
            key={d.id}
            label={t(`space.dim.${d.id}`)}
            value={fmtScore(d.score)}
            sub={t(`space.sub.${d.id}`)}
          />
        ))}
      </KpiGrid>
      {dims.map((d) => (
        <DimTable key={d.id} id={d.id} score={d.score} figures={d.figures} t={t} />
      ))}
    </div>
  );
}

function DimTable({
  id, score, figures, t,
}: {
  id: string;
  score: number | null;
  figures: Record<string, number | null>;
  t: ReturnType<typeof useTranslations>;
}) {
  const rows = Object.entries(figures);
  return (
    <PmCard title={`${t(`space.dim.${id}`)} — ${score == null ? t('space.noSignal') : `${Math.round(score)}/100`}`}>
      {rows.length === 0 ? (
        <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('space.noSignal')}</span>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>{t('space.figure')}</th>
                <th style={thStyle}>{t('space.value')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} style={trStyle}>
                  <td style={tdStyle}>{humanize(k)}</td>
                  <td style={tdMutedStyle}>{fmtFig(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PmCard>
  );
}
