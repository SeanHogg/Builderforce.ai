import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  empMetricsApi,
  type AllocationHealthResult,
  type CollaborationResult,
  type DocActivityResult,
  type LaborCostResult,
  type MemberInitiativeAllocResult,
} from '@/lib/builderforceApi';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { RadarChart } from '@/components/charts/RadarChart';
import { colorAt } from '@/components/charts/chartColors';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { useInsightFormat } from '@/components/insights/format';
import { LocalCollection } from '@/components/pm/LocalCollection';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import {
  empMemberSearch,
  useAllocationDescriptor,
  useCollaborationDescriptor,
  useDocActivityDescriptor,
  useLaborCostDescriptor,
} from './empMetricsCollections';
import { PerformersPanel } from './EmpPerformersPanel';

/**
 * Team analytics — the extended member / EMP metrics lenses (EMP-12..19) on one
 * manager surface: over-allocation, collaboration, documentation activity, labour
 * cost, performer tiers + coaching, and per-member initiative allocation. Each
 * panel reads its own /api/members/* endpoint (MANAGER+). Per-member records
 * render through the ONE Collection (PRD 47); KPI tiles and charts stay charts.
 */

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16,
};
const DANGER = 'var(--danger)';
const OK = 'var(--success)';

function PanelHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

function PanelBody<T>({ data, err, children }: { data: T | null; err: string | null; children: (d: T) => React.ReactNode }) {
  const t = useTranslations('components');
  return (
    <>
      {err && <div style={{ color: DANGER, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {data == null ? (!err && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('emp.loading')}</div>) : children(data)}
    </>
  );
}

/** One fetch per panel; `deps` re-run it (the window). */
function useEmpFetch<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; err: string | null } {
  const errorMessage = useErrorMessage();
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load().then(setData).catch((e: unknown) => setErr(errorMessage(e))); }, [...deps, errorMessage]);
  return { data, err };
}

// ── EMP-12 — over-allocation ─────────────────────────────────────────────────
function AllocationPanel() {
  const { int } = useInsightFormat();
  const t = useTranslations('components');
  const descriptor = useAllocationDescriptor();
  const { data, err } = useEmpFetch<AllocationHealthResult>(() => empMetricsApi.allocationHealth(), []);

  return (
    <div style={card}>
      <PanelHeader title={t('emp.allocationTitle')} sub={t('emp.allocationSub')} />
      <PanelBody data={data} err={err}>
        {(d) => (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <InsightStat label={t('emp.overAllocated')} value={int(d.overAllocatedCount)} color={d.overAllocatedCount > 0 ? DANGER : OK} style={{ minWidth: 150 }} />
              <InsightStat label={t('emp.withinCapacity')} value={int(d.totalMembers - d.overAllocatedCount)} color={OK} style={{ minWidth: 150 }} />
            </div>
            <LocalCollection descriptor={descriptor} rows={d.members} searchText={empMemberSearch} />
          </>
        )}
      </PanelBody>
    </div>
  );
}

// ── EMP-14 — collaboration ───────────────────────────────────────────────────
function CollaborationPanel({ days }: { days: number }) {
  const t = useTranslations('components');
  const descriptor = useCollaborationDescriptor();
  const { data, err } = useEmpFetch<CollaborationResult>(() => empMetricsApi.collaboration(days), [days]);

  const top = data?.members[0];
  const radarAxes = top ? [
    { label: t('emp.reviews'), value: top.breakdown.reviewsPts },
    { label: t('emp.comments'), value: top.breakdown.commentsPts },
    { label: t('emp.handoffs'), value: top.breakdown.handoffPts },
    { label: t('emp.turnaround'), value: top.breakdown.latencyPts },
  ] : [];

  return (
    <div style={card}>
      <PanelHeader title={t('emp.collaborationTitle')} />
      <PanelBody data={data} err={err}>
        {(d) => (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {top && (
              <div style={{ flex: '0 0 auto', maxWidth: 320 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{top.name}</div>
                <RadarChart axes={radarAxes} max={40} color={colorAt(0)} size={200} ariaLabel={t('emp.collaborationTitle')} />
              </div>
            )}
            <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <LocalCollection descriptor={descriptor} rows={d.members} searchText={empMemberSearch} />
            </div>
          </div>
        )}
      </PanelBody>
    </div>
  );
}

// ── EMP-17 — documentation activity ──────────────────────────────────────────
function DocActivityPanel({ days }: { days: number }) {
  const t = useTranslations('components');
  const descriptor = useDocActivityDescriptor();
  const { data, err } = useEmpFetch<DocActivityResult>(() => empMetricsApi.docActivity(days), [days]);

  return (
    <div style={card}>
      <PanelHeader title={t('emp.docTitle')} />
      <PanelBody data={data} err={err}>
        {(d) => <LocalCollection descriptor={descriptor} rows={d.members} searchText={empMemberSearch} />}
      </PanelBody>
    </div>
  );
}

// ── EMP-19 — labour cost ─────────────────────────────────────────────────────
function LaborCostPanel({ days }: { days: number }) {
  const { usd } = useInsightFormat();
  const t = useTranslations('components');
  const descriptor = useLaborCostDescriptor();
  const { data, err } = useEmpFetch<LaborCostResult>(() => empMetricsApi.laborCost(days), [days]);

  const projBars: BarDatum[] = (data?.byProject ?? []).slice(0, 8).map((p, i) => ({ key: p.id, label: p.name, value: p.costUsd, color: colorAt(i) }));
  const initBars: BarDatum[] = (data?.byInitiative ?? []).slice(0, 8).map((p, i) => ({ key: p.id, label: p.name, value: p.costUsd, color: colorAt(i) }));

  return (
    <div style={card}>
      <PanelHeader title={t('emp.costTitle')} />
      <PanelBody data={data} err={err}>
        {(d) => (
          <>
            <div style={{ marginBottom: 12 }}>
              <InsightStat label={t('emp.totalCost')} value={usd(d.totalUsd)} style={{ minWidth: 170 }} />
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{t('emp.project')}</div>
                {projBars.length ? <BarChart data={projBars} formatValue={(v) => usd(v)} ariaLabel={t('emp.project')} /> : <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('emp.noData')}</div>}
              </div>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{t('emp.initiative')}</div>
                {initBars.length ? <BarChart data={initBars} formatValue={(v) => usd(v)} ariaLabel={t('emp.initiative')} /> : <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('emp.noData')}</div>}
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <LocalCollection descriptor={descriptor} rows={d.byMember} searchText={empMemberSearch} />
            </div>
          </>
        )}
      </PanelBody>
    </div>
  );
}

// ── EMP-13 — per-member initiative allocation (a stacked-bar chart, not a list) ─
function InitiativeAllocationPanel({ days }: { days: number }) {
  const t = useTranslations('components');
  const { data, err } = useEmpFetch<MemberInitiativeAllocResult>(() => empMetricsApi.initiativeAllocation(days), [days]);

  const colorByInit = new Map<string, string>();
  (data?.initiatives ?? []).forEach((i, idx) => colorByInit.set(i.id, i.id === 'unassigned' ? 'var(--border-subtle)' : colorAt(idx)));

  return (
    <div style={card}>
      <PanelHeader title={t('emp.initiativesTitle')} />
      <PanelBody data={data} err={err}>
        {(d) => (
          <>
            {d.initiatives.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                {d.initiatives.map((i) => (
                  <span key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 'var(--radius-sm)', background: colorByInit.get(i.id) }} />
                    {i.name}
                  </span>
                ))}
              </div>
            )}
            {d.members.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('emp.noData')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {d.members.map((m) => (
                  <div key={`${m.memberKind}:${m.memberRef}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                      <span style={{ color: 'var(--muted)' }}>{t('emp.allocSummary', { hours: m.totalHours.toFixed(1), count: m.initiativeCount })}</span>
                    </div>
                    <div style={{ display: 'flex', height: 20, borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--border-subtle)' }} title={m.slices.map((s) => `${s.initiativeName} ${s.pct}%`).join(' · ')}>
                      {m.slices.map((s) => (
                        <div key={s.initiativeId} style={{ width: `${s.pct}%`, background: colorByInit.get(s.initiativeId) ?? colorAt(0) }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </PanelBody>
    </div>
  );
}

export function EmpMetricsView() {
  const t = useTranslations('components');
  const [days, setDays] = useState(30);
  const [exporting, setExporting] = useState(false);

  const doExport = async () => {
    setExporting(true);
    try { await empMetricsApi.exportMetrics(days, 'csv'); } catch { /* surfaced via global toast */ }
    finally { setExporting(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{t('emp.teamAnalytics')}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '4px 10px', borderRadius: 'var(--radius-md)', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border-subtle)',
              background: days === d ? 'var(--accent)' : 'var(--bg-base)', color: days === d ? 'var(--text-on-accent)' : 'var(--text-secondary)',
            }}>{t('emp.daysShort', { days: d })}</button>
          ))}
          <button onClick={doExport} disabled={exporting} style={{
            padding: '4px 12px', borderRadius: 'var(--radius-md)', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)', color: 'var(--text-secondary)', opacity: exporting ? 0.6 : 1,
          }}>{exporting ? t('emp.exporting') : t('emp.exportCsv')}</button>
        </div>
      </div>

      <AllocationPanel />
      <CollaborationPanel days={days} />
      <DocActivityPanel days={days} />
      <LaborCostPanel days={days} />
      <PerformersPanel days={days} cardStyle={card} />
      <InitiativeAllocationPanel days={days} />
    </div>
  );
}
