'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  insightsApi, pmoApi, releasesApi, agileMetricsApi,
  type DeliveryInsights, type DeliverableScope, type DeliveryStatus, type BurnPoint,
  type Initiative, type ProductRelease, type VelocityInsights,
  type DeliverableUpdate, type DeliverableUpdateStatus,
} from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { Select } from '@/components/Select';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
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
const btnStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent, #2563eb)',
  color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap',
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

const UPDATE_STATUSES: DeliverableUpdateStatus[] = ['note', 'on_track', 'at_risk', 'blocked', 'done'];
const UPDATE_TONE: Record<DeliverableUpdateStatus, string> = {
  note: 'var(--text-muted)', on_track: '#16a34a', at_risk: '#d97706', blocked: 'var(--danger, #dc2626)', done: '#2563eb',
};

/** Qualitative update/comment stream for the selected deliverable (EMP-11). */
function UpdatesFeed({ scope, id }: { scope: DeliverableScope; id: string }) {
  const t = useTranslations('insights');
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<DeliverableUpdateStatus>('note');
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = usePmData<DeliverableUpdate[]>(() => insightsApi.deliverableUpdates.list(scope, id), [scope, id]);

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); reload(); } finally { setBusy(false); } };

  return (
    <PmCard title={t('deliv.updates')}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Select style={{ ...inputStyle, width: 130 }} value={status} onChange={(e) => setStatus(e.target.value as DeliverableUpdateStatus)} aria-label={t('deliv.updateStatus')}>
          {UPDATE_STATUSES.map((s) => <option key={s} value={s}>{t(`deliv.updateStatusLabel.${s}`)}</option>)}
        </Select>
        <input
          style={{ ...inputStyle, flex: 1 }} value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={t('deliv.updatePlaceholder')}
          onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim() && !busy) run(async () => { await insightsApi.deliverableUpdates.create({ scopeKind: scope, scopeId: id, body: draft, statusLabel: status }); setDraft(''); }); }}
        />
        <button
          type="button" style={btnStyle} disabled={busy || !draft.trim()}
          onClick={() => run(async () => { await insightsApi.deliverableUpdates.create({ scopeKind: scope, scopeId: id, body: draft, statusLabel: status }); setDraft(''); })}
        >
          {t('deliv.postUpdate')}
        </button>
      </div>
      {error ? <PmError message={error} /> : !data || data.length === 0 ? (
        <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('deliv.noUpdates')}</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.map((u) => (
            <div key={u.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, borderLeft: `3px solid ${u.statusLabel ? UPDATE_TONE[u.statusLabel] : 'var(--border-subtle)'}`, paddingLeft: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                <span>
                  {u.statusLabel && <span style={{ color: UPDATE_TONE[u.statusLabel], fontWeight: 600 }}>{t(`deliv.updateStatusLabel.${u.statusLabel}`)} · </span>}
                  {u.authorName ?? t('deliv.someone')} · {u.createdAt.slice(0, 10)}
                </span>
                <button type="button" disabled={busy} title={t('common.delete')} onClick={() => run(() => insightsApi.deliverableUpdates.remove(u.id))}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>×</button>
              </div>
              <div style={{ fontSize: '0.86rem', whiteSpace: 'pre-wrap' }}>{u.body}</div>
            </div>
          ))}
        </div>
      )}
    </PmCard>
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
  // Derived sprint velocity from real task story points (EMP-4) — tenant-wide.
  const { data: velocity } = usePmData<VelocityInsights>(() => agileMetricsApi.derivedVelocity(), []);

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

          {/* Qualitative update stream for this deliverable (EMP-11) */}
          {scope && id && <UpdatesFeed scope={scope} id={id} />}
        </>
      )}

      {/* Derived sprint velocity from real story points (EMP-4) */}
      {velocity && velocity.sprints.length > 0 && (
        <PmCard title={t('deliv.velocity')}>
          <KpiGrid>
            <StatCard label={t('deliv.avgVelocity')} value={velocity.averageVelocity != null ? velocity.averageVelocity.toFixed(1) : '—'} sub={t('deliv.avgVelocitySub', { n: velocity.velocitySampleSize })} />
            <StatCard label={t('deliv.estimated')} value={`${velocity.estimatedTasks}`} sub={t('deliv.estimatedSub', { n: velocity.unestimatedTasks })} />
          </KpiGrid>
          <div style={{ ...tableWrapStyle, marginTop: 12 }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('deliv.sprint')}</th>
                  <th style={thStyle}>{t('deliv.committed')}</th>
                  <th style={thStyle}>{t('deliv.completed')}</th>
                  <th style={thStyle}>{t('deliv.sayDo')}</th>
                </tr>
              </thead>
              <tbody>
                {velocity.sprints.slice(0, 8).map((s) => (
                  <tr key={s.sprintId} style={trStyle}>
                    <td style={tdStyle}>{s.name}</td>
                    <td style={tdMutedStyle}>{s.committedPoints}</td>
                    <td style={tdMutedStyle}>{s.completedPoints}</td>
                    <td style={tdMutedStyle}>{s.completionRatePct != null ? pct(s.completionRatePct) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PmCard>
      )}
    </div>
  );
}
