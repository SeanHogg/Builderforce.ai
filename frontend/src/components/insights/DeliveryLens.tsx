'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  insightsApi, pmoApi, releasesApi, agileMetricsApi,
  type DeliveryInsights, type DeliverableScope, type DeliveryStatus, type BurnPoint,
  type Initiative, type ProductRelease, type VelocityInsights,
  type DeliverableUpdate, type DeliverableUpdateStatus,
  type ScenarioResponse, type LifecycleInsights, type LifecyclePhase, type ScopeEffortPoint,
} from '@/lib/builderforceApi';
import { ValueStreamGraph } from './ValueStreamGraph';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { Select } from '@/components/Select';
import { TrendChart } from '@/components/charts/TrendChart';
import { colorAt } from '@/components/charts/chartColors';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { KpiGrid } from './LensShell';
import { pct } from './format';

/** Compact hours → "Xd Yh" / "Yh" / "Zm" for lifecycle phase durations. */
function fmtDur(hours: number): string {
  if (hours <= 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return h ? `${d}d ${h}h` : `${d}d`;
}

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

const PROJECTION_COLOR = '#7c5cff';

/**
 * Value-delivery chart — historical burnup (scope dashed, completed filled) plus a
 * forward PROJECTION of the completed line to the forecast date (the "when will
 * value land" ramp), with a today marker and an optional target-date marker. Pure
 * SVG on a time x-axis so the projection lines up with history by calendar date.
 */
function BurnChart({ series, projection, targetDate }: { series: BurnPoint[]; projection: BurnPoint[]; targetDate: string | null }) {
  const t = useTranslations('insights');
  const W = 640, H = 240, PAD = 30;
  if (series.length < 2) return <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('deliv.noSeries')}</span>;

  const ms = (d: string) => new Date(d).getTime();
  const histMs = series.map((p) => ms(p.date));
  const projMs = projection.map((p) => ms(p.date));
  const t0 = histMs[0]!;
  const todayMs = histMs[histMs.length - 1]!;
  const ends = [todayMs, ...projMs];
  if (targetDate) ends.push(ms(targetDate));
  const t1 = Math.max(...ends);
  const span = Math.max(1, t1 - t0);
  const maxScope = Math.max(1, ...series.map((p) => p.scope), ...projection.map((p) => p.scope));

  const x = (m: number) => PAD + ((m - t0) / span) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - (v / maxScope) * (H - 2 * PAD);
  const path = (rows: BurnPoint[], sel: (p: BurnPoint) => number) =>
    rows.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(ms(p.date)).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(' ');
  const areaCompleted = `${path(series, (p) => p.completed)} L${x(todayMs).toFixed(1)},${y(0)} L${x(t0).toFixed(1)},${y(0)} Z`;
  const todayX = x(todayMs);
  const targetX = targetDate ? x(ms(targetDate)) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('deliv.chartAria')} style={{ maxWidth: '100%' }}>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border-subtle)" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--border-subtle)" />

      {/* target-date marker */}
      {targetX != null && (
        <g>
          <line x1={targetX} y1={PAD} x2={targetX} y2={H - PAD} stroke="var(--danger, #dc2626)" strokeWidth={1} strokeDasharray="2 3" opacity={0.8} />
          <text x={Math.min(targetX + 4, W - PAD)} y={PAD + 2} fontSize={9} fill="var(--danger, #dc2626)">{t('deliv.legendTarget')}</text>
        </g>
      )}
      {/* today marker */}
      <line x1={todayX} y1={PAD} x2={todayX} y2={H - PAD} stroke="var(--text-muted)" strokeWidth={1} opacity={0.5} />
      <text x={todayX} y={H - 18} fontSize={9} fill="var(--text-muted)" textAnchor="middle">{t('deliv.legendToday')}</text>

      <path d={areaCompleted} fill="#2563eb22" stroke="none" />
      <path d={path(series, (p) => p.scope)} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d={path(series, (p) => p.completed)} fill="none" stroke="#2563eb" strokeWidth={2} />
      {/* forward projection of completed → scope at current pace */}
      {projection.length >= 2 && (
        <path d={path(projection, (p) => p.completed)} fill="none" stroke={PROJECTION_COLOR} strokeWidth={2} strokeDasharray="5 3" />
      )}

      <text x={PAD} y={PAD - 12} fontSize={11} fill="var(--text-muted)">{maxScope}</text>
      <text x={W - PAD} y={H - 6} fontSize={10} fill="var(--text-muted)" textAnchor="end">{new Date(t1).toISOString().slice(0, 10)}</text>
      <text x={PAD} y={H - 6} fontSize={10} fill="var(--text-muted)">{series[0]!.date}</text>
    </svg>
  );
}

const POINTS_DONE_COLOR = '#22c55e';
const POINTS_DEFINED_COLOR = 'var(--text-muted)';

/**
 * Scope & Effort chart — value delivered in STORY POINTS over time (completed
 * filled, defined-but-open above it) with the development FTE line overlaid on a
 * secondary axis. The points answer "how much value", the FTE line "how much
 * capacity drove it" — the Jellyfish "Scope and Effort" view. Pure SVG.
 */
function ScopeEffortChart({ points, hasEffort }: { points: ScopeEffortPoint[]; hasEffort: boolean }) {
  const t = useTranslations('insights');
  const W = 640, H = 240, PAD = 34;
  if (points.length < 2) return <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('deliv.noSeries')}</span>;

  const maxPts = Math.max(1, ...points.map((p) => p.definedPoints));
  const maxFte = Math.max(0.1, ...points.map((p) => p.fte));
  const plotW = W - 2 * PAD, plotH = H - 2 * PAD;
  const bandW = plotW / points.length;
  const barW = Math.max(2, bandW * 0.7);
  const yPts = (v: number) => H - PAD - (v / maxPts) * plotH;
  const xAt = (i: number) => PAD + i * bandW + (bandW - barW) / 2;
  const fteX = (i: number) => PAD + i * bandW + bandW / 2;
  const fteY = (v: number) => H - PAD - (v / maxFte) * plotH;
  const fteLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fteX(i).toFixed(1)},${fteY(p.fte).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('deliv.scopeEffort.aria')} style={{ maxWidth: '100%' }}>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--border-subtle)" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--border-subtle)" />
      {points.map((p, i) => {
        const doneTop = yPts(p.completedPoints);
        const defTop = yPts(p.definedPoints);
        const base = yPts(0);
        return (
          <g key={p.date}>
            {/* defined-but-open (gray) from completed up to defined */}
            <rect x={xAt(i)} y={defTop} width={barW} height={Math.max(0, doneTop - defTop)} fill="var(--text-muted)" opacity={0.25} rx={1} />
            {/* completed (green) from baseline up to completed */}
            <rect x={xAt(i)} y={doneTop} width={barW} height={Math.max(0, base - doneTop)} fill={POINTS_DONE_COLOR} rx={1} />
          </g>
        );
      })}
      {hasEffort && <path d={fteLine} fill="none" stroke={PROJECTION_COLOR} strokeWidth={2} />}
      {/* axes labels */}
      <text x={PAD} y={PAD - 14} fontSize={11} fill="var(--text-muted)">{maxPts} {t('deliv.scopeEffort.ptsAxis')}</text>
      {hasEffort && <text x={W - PAD} y={PAD - 14} fontSize={11} fill={PROJECTION_COLOR} textAnchor="end">{maxFte.toFixed(1)} {t('deliv.scopeEffort.fteAxis')}</text>}
      <text x={PAD} y={H - 6} fontSize={10} fill="var(--text-muted)">{points[0]!.date}</text>
      <text x={W - PAD} y={H - 6} fontSize={10} fill="var(--text-muted)" textAnchor="end">{points[points.length - 1]!.date}</text>
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

const PHASE_ORDER: LifecyclePhase[] = ['refinement', 'work', 'review', 'deploy'];

const sliderRow: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const sliderLabel: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' };

/**
 * Scenario planner — model the deliverable's completion under different team size,
 * focus, and scope, graded against its target. Server-computed off the live
 * delivery baseline (single source of truth); debounced as the levers move.
 * Keyed by deliverable in the parent so the levers reset on a deliverable switch.
 */
function ScenarioPlanner({ scope, id, baseline }: { scope: DeliverableScope; id: string; baseline: DeliveryInsights }) {
  const t = useTranslations('insights');
  const [developers, setDevelopers] = useState(Math.max(1, baseline.activeContributors));
  const [attentionPct, setAttentionPct] = useState(100);
  const [scopeDelta, setScopeDelta] = useState(0);
  const [res, setRes] = useState<ScenarioResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const h = setTimeout(() => {
      insightsApi.deliveryScenario(scope, id, { developers, attentionPct, scopeDelta })
        .then((r) => { if (alive) setRes(r); })
        .catch(() => { if (alive) setRes(null); });
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [scope, id, developers, attentionPct, scopeDelta]);

  const s = res?.scenario;
  const deltaLabel = s?.deltaDaysVsTarget == null ? null
    : s.deltaDaysVsTarget > 0 ? t('deliv.scenario.daysLate', { n: s.deltaDaysVsTarget })
    : s.deltaDaysVsTarget < 0 ? t('deliv.scenario.daysEarly', { n: -s.deltaDaysVsTarget })
    : t('deliv.scenario.onTheDay');

  return (
    <PmCard title={t('deliv.scenario.title')}>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 0 }}>{t('deliv.scenario.subtitle')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div style={sliderRow}>
          <span style={sliderLabel}><span>{t('deliv.scenario.developers')}</span><strong>{developers}</strong></span>
          <input type="range" min={0} max={Math.max(12, baseline.activeContributors * 3)} step={1} value={developers}
            onChange={(e) => setDevelopers(Number(e.target.value))} aria-label={t('deliv.scenario.developers')} />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('deliv.scenario.developersHint', { n: Math.max(1, baseline.activeContributors) })}</span>
        </div>
        <div style={sliderRow}>
          <span style={sliderLabel}><span>{t('deliv.scenario.attention')}</span><strong>{attentionPct}%</strong></span>
          <input type="range" min={0} max={100} step={5} value={attentionPct}
            onChange={(e) => setAttentionPct(Number(e.target.value))} aria-label={t('deliv.scenario.attention')} />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('deliv.scenario.attentionHint')}</span>
        </div>
        <div style={sliderRow}>
          <span style={sliderLabel}><span>{t('deliv.scenario.scope')}</span><strong>{scopeDelta > 0 ? `+${scopeDelta}` : scopeDelta}</strong></span>
          <input type="range" min={-baseline.openTasks} max={Math.max(20, baseline.openTasks)} step={1} value={scopeDelta}
            onChange={(e) => setScopeDelta(Number(e.target.value))} aria-label={t('deliv.scenario.scope')} />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('deliv.scenario.scopeHint', { n: s?.adjustedOpenTasks ?? baseline.openTasks })}</span>
        </div>
      </div>

      <KpiGrid>
        <StatCard label={t('deliv.scenario.projectedDate')} value={s?.projectedDate ?? '—'}
          sub={deltaLabel ?? (baseline.targetDate ? t('deliv.target', { d: baseline.targetDate }) : t('deliv.noTarget'))} />
        <StatCard label={t('deliv.status')} value={s ? t(`deliv.statusLabel.${s.status}`) : '—'}
          sub={baseline.forecastDate ? t('deliv.scenario.baselineForecast', { d: baseline.forecastDate }) : t('deliv.forecastNone')} />
        <StatCard label={t('deliv.scenario.projectedPace')} value={s ? `${s.projectedThroughputPerWeek.toFixed(1)}/${t('deliv.week')}` : '—'}
          sub={t('deliv.scenario.baselinePace', { n: baseline.throughputPerWeek.toFixed(1) })} />
        <StatCard label={t('deliv.scenario.effort')} value={s?.effortPersonWeeks != null ? t('deliv.scenario.personWeeks', { n: s.effortPersonWeeks.toFixed(1) }) : '—'}
          sub={s?.projectedWeeks != null ? t('deliv.scenario.weeksRemaining', { n: s.projectedWeeks.toFixed(1) }) : '—'} />
      </KpiGrid>
      {s && (
        <div style={{ marginTop: 10, fontSize: '0.8rem', color: STATUS_TONE[s.status], fontWeight: 600 }}>
          {t(`deliv.scenario.verdict.${s.status}`)}
        </div>
      )}
    </PmCard>
  );
}

/** Life cycle explorer — time per SDLC phase (Refinement → Work → Review → Deploy)
 *  and the end-to-end lifecycle trend over recent months. Tenant-wide. */
function LifecycleExplorer() {
  const t = useTranslations('insights');
  const { data, error } = usePmData<LifecycleInsights>(() => insightsApi.lifecycle(30), []);
  if (error) return <PmError message={error} />;
  if (!data) return null;

  const maxAvg = Math.max(1, ...data.byPhase.map((p) => p.avgHours));
  const phases = [...data.byPhase].sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));

  return (
    <PmCard title={t('deliv.lifecycle.title')}>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 0 }}>
        {t('deliv.lifecycle.subtitle', { d: fmtDur(data.totalAvgHours), n: data.sampleSize })}
      </p>
      {data.sampleSize === 0 ? (
        <PmEmpty message={t('deliv.lifecycle.empty')} />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {phases.map((p, i) => (
              <div key={p.phase} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 84px', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>{t(`deliv.lifecycle.phase.${p.phase}`)}</span>
                <div style={{ background: 'var(--bg-subtle, #00000010)', borderRadius: 6, height: 18, overflow: 'hidden' }}>
                  <div style={{ width: `${(p.avgHours / maxAvg) * 100}%`, height: '100%', background: colorAt(i), borderRadius: 6, minWidth: p.avgHours > 0 ? 2 : 0 }} />
                </div>
                <span style={{ fontSize: '0.82rem', textAlign: 'right', fontWeight: 600 }} title={t('deliv.lifecycle.median', { d: fmtDur(p.medianHours) })}>
                  {fmtDur(p.avgHours)}
                </span>
              </div>
            ))}
          </div>
          {data.trend.length >= 2 && (
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>{t('deliv.lifecycle.trend')}</div>
              <TrendChart
                labels={data.trend.map((p) => p.period)}
                series={[{ key: 'lifecycle', label: t('deliv.lifecycle.trendSeries'), values: data.trend.map((p) => p.avgLifecycleHours / 24), color: PROJECTION_COLOR }]}
                formatValue={(v) => `${v.toFixed(0)}d`}
                area
                ariaLabel={t('deliv.lifecycle.trendAria')}
              />
            </div>
          )}
        </>
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
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8, fontSize: '0.78rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 0, borderTop: '1.5px dashed var(--text-muted)', display: 'inline-block' }} /> {t('deliv.legendScope')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 2, background: '#2563eb', display: 'inline-block' }} /> {t('deliv.legendDone')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 0, borderTop: `2px dashed ${PROJECTION_COLOR}`, display: 'inline-block' }} /> {t('deliv.legendProjected')}</span>
              <span style={{ color: STATUS_TONE[data.status], fontWeight: 600 }}>{t(`deliv.statusLabel.${data.status}`)}</span>
            </div>
            <BurnChart series={data.series} projection={data.projection} targetDate={data.targetDate} />
          </PmCard>

          {/* What-if completion modelling for this deliverable. Keyed so the levers
              reset to the new baseline when the deliverable changes. */}
          {scope && id && <ScenarioPlanner key={`${scope}:${id}`} scope={scope} id={id} baseline={data} />}

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

      {/* Life cycle explorer — tenant-wide time per SDLC phase + lifecycle trend. */}
      <LifecycleExplorer />
    </div>
  );
}
