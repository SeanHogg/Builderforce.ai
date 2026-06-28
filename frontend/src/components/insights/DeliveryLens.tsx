'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  insightsApi, pmoApi, releasesApi,
  type DeliveryInsights, type DeliverableScope, type DeliveryStatus, type BurnPoint,
  type Initiative, type ProductRelease,
} from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { Select } from '@/components/Select';
import { KpiGrid } from './LensShell';
import { pct } from './format';

const STATUS_TONE: Record<DeliveryStatus, string> = {
  on_track: '#16a34a', at_risk: '#d97706', late: 'var(--danger, #dc2626)',
  done: '#2563eb', no_signal: 'var(--text-muted)',
};

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};

interface Pick { scope: DeliverableScope; id: string; label: string }

/** Pure SVG burnup/burndown chart — scope (top line), completed (filled), remaining. */
function BurnChart({ series }: { series: BurnPoint[] }) {
  const t = useTranslations('insights');
  const W = 640, H = 220, PAD = 28;
  if (series.length < 2) return <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('deliv.noSeries')}</span>;
  const maxScope = Math.max(1, ...series.map((p) => p.scope));
  const x = (i: number) => PAD + (i / (series.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - (v / maxScope) * (H - 2 * PAD);
  const line = (sel: (p: BurnPoint) => number) => series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(' ');
  const areaCompleted = `${line((p) => p.completed)} L${x(series.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('deliv.chartAria')} style={{ maxWidth: '100%' }}>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border-subtle)" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--border-subtle)" />
      <path d={areaCompleted} fill="#2563eb22" stroke="none" />
      <path d={line((p) => p.scope)} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d={line((p) => p.completed)} fill="none" stroke="#2563eb" strokeWidth={2} />
      <text x={PAD} y={PAD - 10} fontSize={11} fill="var(--text-muted)">{maxScope}</text>
      <text x={W - PAD} y={H - 8} fontSize={10} fill="var(--text-muted)" textAnchor="end">{series[series.length - 1]!.date}</text>
      <text x={PAD} y={H - 8} fontSize={10} fill="var(--text-muted)">{series[0]!.date}</text>
    </svg>
  );
}

export function DeliveryLens() {
  const t = useTranslations('insights');
  const [picks, setPicks] = useState<Pick[]>([]);
  const [selected, setSelected] = useState<string>(''); // "scope:id"

  // Build the deliverable picker from initiatives + projects + releases.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [inits, projs, rels] = await Promise.all([
        pmoApi.initiatives.list().catch(() => [] as Initiative[]),
        fetchProjects().catch(() => [] as Project[]),
        releasesApi.list().catch(() => [] as ProductRelease[]),
      ]);
      if (!alive) return;
      const list: Pick[] = [
        ...inits.map((i) => ({ scope: 'initiative' as const, id: i.id, label: `${t('deliv.kind.initiative')}: ${i.name}` })),
        ...projs.map((p) => ({ scope: 'project' as const, id: String(p.id), label: `${t('deliv.kind.project')}: ${p.name}` })),
        ...rels.map((r) => ({ scope: 'release' as const, id: r.id, label: `${t('deliv.kind.release')}: ${r.version ? `${r.name} (${r.version})` : r.name}` })),
      ];
      setPicks(list);
      if (list.length && !selected) setSelected(`${list[0].scope}:${list[0].id}`);
    })();
    return () => { alive = false; };
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const [scope, id] = useMemo(() => {
    const i = selected.indexOf(':');
    return i < 0 ? [null, null] : [selected.slice(0, i) as DeliverableScope, selected.slice(i + 1)];
  }, [selected]);

  const { data, error } = usePmData<DeliveryInsights | null>(
    () => (scope && id ? insightsApi.delivery(scope, id) : Promise.resolve(null)),
    [scope, id],
  );

  const picker = (
    <Select style={{ ...inputStyle, minWidth: 260 }} value={selected} onChange={(e) => setSelected(e.target.value)} aria-label={t('deliv.deliverable')}>
      {picks.length === 0 && <option value="">{t('deliv.noDeliverables')}</option>}
      {picks.map((p) => <option key={`${p.scope}:${p.id}`} value={`${p.scope}:${p.id}`}>{p.label}</option>)}
    </Select>
  );

  if (error) return <PmError message={error} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{picker}</div>

      {!data ? (
        <PmEmpty message={picks.length ? t('loading') : t('deliv.noDeliverables')} />
      ) : (
        <>
          <KpiGrid>
            <StatCard label={t('deliv.progress')} value={pct(data.completionPct)} sub={t('deliv.progressSub', { done: data.completedTasks, total: data.totalTasks })} />
            <StatCard label={t('deliv.status')} value={t(`deliv.statusLabel.${data.status}`)} sub={data.targetDate ? t('deliv.target', { d: data.targetDate }) : t('deliv.noTarget')} />
            <StatCard label={t('deliv.forecast')} value={data.forecastDate ?? '—'} sub={data.forecastDate ? t('deliv.forecastBand', { o: data.forecastDateOptimistic ?? '—', p: data.forecastDatePessimistic ?? '—' }) : t('deliv.forecastNone')} />
            <StatCard label={t('deliv.scopeCreep')} value={pct(data.addedScopePct)} sub={t('deliv.scopeCreepSub', { added: data.addedScope, base: data.baselineScope })} />
          </KpiGrid>

          <PmCard title={t('deliv.burnup')}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 0, borderTop: '1.5px dashed var(--text-muted)', display: 'inline-block' }} /> {t('deliv.legendScope')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 2, background: '#2563eb', display: 'inline-block' }} /> {t('deliv.legendDone')}</span>
              <span style={{ color: STATUS_TONE[data.status], fontWeight: 600 }}>{t(`deliv.statusLabel.${data.status}`)}</span>
            </div>
            <BurnChart series={data.series} />
          </PmCard>

          <PmCard title={t('deliv.detail')}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, fontSize: '0.85rem' }}>
              <div><div style={{ color: 'var(--text-muted)' }}>{t('deliv.throughput')}</div><div style={{ fontWeight: 600 }}>{data.throughputPerWeek.toFixed(1)}/{t('deliv.week')}</div></div>
              <div><div style={{ color: 'var(--text-muted)' }}>{t('deliv.open')}</div><div style={{ fontWeight: 600 }}>{data.openTasks}</div></div>
              <div><div style={{ color: 'var(--text-muted)' }}>{t('deliv.baseline')}</div><div style={{ fontWeight: 600 }}>{data.baselineDate ?? '—'}</div></div>
              <div><div style={{ color: 'var(--text-muted)' }}>{t('deliv.baselineScope')}</div><div style={{ fontWeight: 600 }}>{data.baselineScope}</div></div>
            </div>
          </PmCard>
        </>
      )}
    </div>
  );
}
