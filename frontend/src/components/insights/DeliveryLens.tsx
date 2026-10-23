import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  insightsApi, pmoApi, agileMetricsApi,
  type DeliveryInsights, type DeliverableScope, type BurnPoint,
  type Initiative, type VelocityInsights,
  type ScopeEffortPoint,
} from '@/lib/builderforceApi';
import { releasesApi, type ReleaseList, type ReleaseSchedule } from '@/lib/releasesApi';
import { ValueStreamGraph } from './ValueStreamGraph';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { Select } from '@/components/Select';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { KpiGrid } from './LensShell';
import { pct } from './format';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { statusColor } from '@/lib/statusTone';
import { STATUS_TONE, PROJECTION_COLOR, inputStyle } from './deliveryLensShared';
import { DeliverableUpdatesFeed } from './DeliverableUpdatesFeed';
import { DeliveryLifecycleExplorer } from './DeliveryLifecycleExplorer';
import { DeliveryScenarioPlanner } from './DeliveryScenarioPlanner';

interface Pick { scope: DeliverableScope; id: string; label: string }

const EMPTY_RELEASES: ReleaseList = {
  releases: [],
  schedule: { released: 0, measured: 0, onTime: 0, late: 0, onTimeRatePct: null, avgDaysLate: null, overdue: 0, upcoming: 0 },
};

/** The Status card's sub-line: a shipped release is graded plan vs actual
 *  (released on/before target, or N days late); anything else shows its target. */
function statusSub(t: ReturnType<typeof useTranslations>, data: DeliveryInsights): string {
  if (data.releasedAt) {
    if (data.slipDays == null) return t('deliv.released', { d: data.releasedAt });
    return data.slipDays > 0
      ? t('deliv.releasedLate', { d: data.releasedAt, n: data.slipDays })
      : t('deliv.releasedOnTime', { d: data.releasedAt });
  }
  return data.targetDate ? t('deliv.target', { d: data.targetDate }) : t('deliv.noTarget');
}

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
          <line x1={targetX} y1={PAD} x2={targetX} y2={H - PAD} stroke="var(--danger)" strokeWidth={1} strokeDasharray="2 3" opacity={0.8} />
          <text x={Math.min(targetX + 4, W - PAD)} y={PAD + 2} fontSize={9} fill="var(--danger)">{t('deliv.legendTarget')}</text>
        </g>
      )}
      {/* today marker */}
      <line x1={todayX} y1={PAD} x2={todayX} y2={H - PAD} stroke="var(--text-muted)" strokeWidth={1} opacity={0.5} />
      <text x={todayX} y={H - 18} fontSize={9} fill="var(--text-muted)" textAnchor="middle">{t('deliv.legendToday')}</text>

      <path d={areaCompleted} fill="color-mix(in srgb, var(--info) 13%, transparent)" stroke="none" />
      <path d={path(series, (p) => p.scope)} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d={path(series, (p) => p.completed)} fill="none" stroke="var(--info)" strokeWidth={2} />
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

const POINTS_DONE_COLOR = 'var(--success)';
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

export function DeliveryLens() {
  const t = useTranslations('insights');
  const { currentProjectId } = useProjectScope();
  const [picks, setPicks] = useState<Pick[]>([]);
  const [selected, setSelected] = useState<string>(''); // "scope:id"
  const [releaseSchedule, setReleaseSchedule] = useState<ReleaseSchedule | null>(null);

  // Build the deliverable picker from initiatives + projects + releases.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [inits, projs, releaseList] = await Promise.all([
        pmoApi.initiatives.list().catch(() => [] as Initiative[]),
        fetchProjects().catch(() => [] as Project[]),
        releasesApi.list().catch(() => EMPTY_RELEASES),
      ]);
      if (!alive) return;
      const rels = releaseList.releases;
      setReleaseSchedule(releaseList.schedule);
      const list: Pick[] = currentProjectId == null ? [
        ...inits.map((i) => ({ scope: 'initiative' as const, id: i.id, label: `${t('deliv.kind.initiative')}: ${i.name}` })),
        ...projs.map((p) => ({ scope: 'project' as const, id: String(p.id), label: `${t('deliv.kind.project')}: ${p.name}` })),
        ...rels.map((r) => ({ scope: 'release' as const, id: r.id, label: `${t('deliv.kind.release')}: ${r.version ? `${r.name} (${r.version})` : r.name}` })),
      ] : projs
        .filter((p) => p.id === currentProjectId)
        .map((p) => ({ scope: 'project' as const, id: String(p.id), label: `${t('deliv.kind.project')}: ${p.name}` }));
      setPicks(list);
      if (list.length) {
        const preferred = currentProjectId == null && list.some((p) => `${p.scope}:${p.id}` === selected)
          ? selected
          : `${list[0].scope}:${list[0].id}`;
        setSelected(preferred);
      } else {
        setSelected('');
      }
    })();
    return () => { alive = false; };
  }, [t, currentProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [scope, id] = useMemo(() => {
    const i = selected.indexOf(':');
    return i < 0 ? [null, null] : [selected.slice(0, i) as DeliverableScope, selected.slice(i + 1)];
  }, [selected]);

  const { data, error } = usePmData<DeliveryInsights | null>(
    () => (scope && id ? insightsApi.delivery(scope, id) : Promise.resolve(null)),
    [scope, id],
  );
  // Derived sprint velocity from real task story points (EMP-4), project-scoped
  // whenever the global selector has a project selected.
  const { data: velocity } = usePmData<VelocityInsights>(() => agileMetricsApi.derivedVelocity(currentProjectId), [currentProjectId]);

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
            <StatCard label={t('deliv.status')} value={t(`deliv.statusLabel.${data.status}`)} sub={statusSub(t, data)} />
            <StatCard label={t('deliv.forecast')} value={data.forecastDate ?? '—'} sub={data.forecastDate ? t('deliv.forecastBand', { o: data.forecastDateOptimistic ?? '—', p: data.forecastDatePessimistic ?? '—' }) : t('deliv.forecastNone')} />
            <StatCard label={t('deliv.scopeCreep')} value={pct(data.addedScopePct)} sub={t('deliv.scopeCreepSub', { added: data.addedScope, base: data.baselineScope })} />
            {/* Plan vs actual across releases: shipped on or before the target date. */}
            {scope === 'release' && releaseSchedule && (
              <StatCard
                label={t('deliv.releaseOnTime')}
                value={releaseSchedule.onTimeRatePct != null ? pct(releaseSchedule.onTimeRatePct) : '—'}
                sub={releaseSchedule.measured > 0
                  ? t('deliv.releaseOnTimeSub', { onTime: releaseSchedule.onTime, measured: releaseSchedule.measured })
                  : t('deliv.releaseOnTimeNone')}
              />
            )}
          </KpiGrid>

          <PmCard title={t('deliv.burnup')}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8, fontSize: '0.78rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 0, borderTop: '1.5px dashed var(--text-muted)', display: 'inline-block' }} /> {t('deliv.legendScope')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 2, background: 'var(--info)', display: 'inline-block' }} /> {t('deliv.legendDone')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 0, borderTop: `2px dashed ${PROJECTION_COLOR}`, display: 'inline-block' }} /> {t('deliv.legendProjected')}</span>
              <span style={{ color: statusColor(STATUS_TONE, data.status), fontWeight: 600 }}>{t(`deliv.statusLabel.${data.status}`)}</span>
            </div>
            <BurnChart series={data.series} projection={data.projection} targetDate={data.targetDate} />
          </PmCard>

          {/* Value delivered in story points + the development FTE that drove it.
              Shown when the work is estimated or has logged effort. */}
          {(data.hasPoints || data.hasEffort) && (
            <PmCard title={t('deliv.scopeEffort.title')}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8, fontSize: '0.78rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, background: POINTS_DONE_COLOR, borderRadius: 'var(--radius-sm)', display: 'inline-block' }} /> {t('deliv.scopeEffort.completed')}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, background: POINTS_DEFINED_COLOR, opacity: 0.25, borderRadius: 'var(--radius-sm)', display: 'inline-block' }} /> {t('deliv.scopeEffort.defined')}</span>
                {data.hasEffort && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 2, background: PROJECTION_COLOR, display: 'inline-block' }} /> {t('deliv.scopeEffort.fte')}</span>}
              </div>
              <ScopeEffortChart points={data.scopeEffort} hasEffort={data.hasEffort} />
              <KpiGrid>
                <StatCard label={t('deliv.scopeEffort.totalPoints')} value={data.hasPoints ? `${data.totalPoints}` : '—'} sub={t('deliv.scopeEffort.donePoints', { n: data.donePoints })} />
                <StatCard label={t('deliv.scopeEffort.cancelledPoints')} value={data.hasPoints ? `${data.cancelledPoints}` : '—'} sub={t('deliv.scopeEffort.cancelledSub')} />
                <StatCard label={t('deliv.scopeEffort.currentFte')} value={data.hasEffort ? data.currentFte.toFixed(1) : '—'} sub={t('deliv.scopeEffort.fteSub')} />
              </KpiGrid>
            </PmCard>
          )}

          {/* What-if completion modelling for this deliverable. Keyed so the levers
              reset to the new baseline when the deliverable changes. */}
          {scope && id && <DeliveryScenarioPlanner key={`${scope}:${id}`} scope={scope} id={id} baseline={data} />}

          <PmCard title={t('deliv.detail')}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, fontSize: '0.85rem' }}>
              <div><div style={{ color: 'var(--text-muted)' }}>{t('deliv.throughput')}</div><div style={{ fontWeight: 600 }}>{data.throughputPerWeek.toFixed(1)}/{t('deliv.week')}</div></div>
              <div><div style={{ color: 'var(--text-muted)' }}>{t('deliv.open')}</div><div style={{ fontWeight: 600 }}>{data.openTasks}</div></div>
              <div><div style={{ color: 'var(--text-muted)' }}>{t('deliv.baseline')}</div><div style={{ fontWeight: 600 }}>{data.baselineDate ?? '—'}</div></div>
              <div><div style={{ color: 'var(--text-muted)' }}>{t('deliv.baselineScope')}</div><div style={{ fontWeight: 600 }}>{data.baselineScope}</div></div>
            </div>
          </PmCard>

          {/* Qualitative update stream for this deliverable (EMP-11) */}
          {scope && id && <DeliverableUpdatesFeed scope={scope} id={id} />}
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

      {/* Life cycle explorer — scoped time per SDLC phase + lifecycle trend. */}
      <DeliveryLifecycleExplorer />

      {/* Value stream — the cross-artifact initiative dependency graph + critical
          path. Self-hides when there are no initiatives in scope. */}
      <ValueStreamGraph />
    </div>
  );
}
