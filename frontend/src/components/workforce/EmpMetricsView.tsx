'use client';

import { Fragment, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  empMetricsApi,
  type AllocationHealthResult,
  type CollaborationResult,
  type CoachingNote,
  type DocActivityResult,
  type LaborCostResult,
  type MemberInitiativeAllocResult,
  type PerformerRow,
  type PerformerTier,
  type PerformerTiersResult,
} from '@/lib/builderforceApi';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { RadarChart } from '@/components/charts/RadarChart';
import { colorAt } from '@/components/charts/chartColors';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { hrs, int, pct, usd } from '@/components/insights/format';

/**
 * Team analytics — the extended member / EMP metrics lenses (EMP-12..19) on one
 * manager surface: over-allocation, collaboration, documentation activity, labour
 * cost, performer tiers + coaching, and per-member initiative allocation. Each
 * panel reads its own /api/members/* endpoint (MANAGER+). Fully localized, theme-
 * token styled (light + dark), and horizontally scrollable on narrow screens.
 */

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};
const th: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 11, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 13, whiteSpace: 'nowrap' };
const thL: React.CSSProperties = { ...th, textAlign: 'left' };
const tdL: React.CSSProperties = { ...td, textAlign: 'left' };
const DANGER = 'var(--danger, #e5484d)';
const WARN = 'var(--warning, #f5a623)';
const OK = 'var(--success, #16a34a)';

function PanelHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

function ScrollTable({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table></div>;
}

// ── EMP-12 — over-allocation ─────────────────────────────────────────────────
function AllocationPanel() {
  const t = useTranslations('widgets');
  const [data, setData] = useState<AllocationHealthResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { empMetricsApi.allocationHealth().then(setData).catch((e: Error) => setErr(e.message)); }, []);

  return (
    <div style={card}>
      <PanelHeader title={t('emp.allocationTitle')} sub={t('emp.allocationSub')} />
      {err && <div style={{ color: DANGER, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {data && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <InsightStat label={t('emp.overAllocated')} value={int(data.overAllocatedCount)} color={data.overAllocatedCount > 0 ? DANGER : OK} style={{ minWidth: 150 }} />
          <InsightStat label={t('emp.withinCapacity')} value={int(data.totalMembers - data.overAllocatedCount)} color={OK} style={{ minWidth: 150 }} />
        </div>
      )}
      <ScrollTable>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <th style={thL}>{t('emp.member')}</th>
            <th style={th}>{t('emp.wip')}</th>
            <th style={th}>{t('emp.max')}</th>
            <th style={th}>{t('emp.utilization')}</th>
          </tr>
        </thead>
        <tbody>
          {data == null ? (
            <tr><td style={tdL} colSpan={4}>{t('emp.loading')}</td></tr>
          ) : data.members.length === 0 ? (
            <tr><td style={{ ...tdL, color: 'var(--muted)' }} colSpan={4}>{t('emp.noData')}</td></tr>
          ) : data.members.map((m) => (
            <tr key={`${m.memberKind}:${m.memberRef}`} style={{ borderBottom: '1px solid var(--border-subtle)', background: m.overAllocated ? 'rgba(229,72,77,0.08)' : undefined }}>
              <td style={tdL}>
                {m.name}
                {m.overAllocated && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#fff', background: DANGER, padding: '1px 6px', borderRadius: 999 }}>{t('emp.overAllocated')}</span>}
              </td>
              <td style={td}>{m.observedWip}</td>
              <td style={{ ...td, color: 'var(--muted)' }}>{m.maxWip}</td>
              <td style={{ ...td, fontWeight: 700, color: m.overAllocated ? DANGER : m.utilizationPct >= 80 ? WARN : undefined }}>{pct(m.utilizationPct)}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </div>
  );
}

// ── EMP-14 — collaboration ───────────────────────────────────────────────────
function CollaborationPanel({ days }: { days: number }) {
  const t = useTranslations('widgets');
  const [data, setData] = useState<CollaborationResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { empMetricsApi.collaboration(days).then(setData).catch((e: Error) => setErr(e.message)); }, [days]);

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
      {err && <div style={{ color: DANGER, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {top && (
          <div style={{ flex: '0 0 auto', maxWidth: 320 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{top.name}</div>
            <RadarChart axes={radarAxes} max={40} color={colorAt(0)} size={200} ariaLabel={t('emp.collaborationTitle')} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 280 }}>
          <ScrollTable>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={thL}>{t('emp.member')}</th>
                <th style={th}>{t('emp.reviews')}</th>
                <th style={th}>{t('emp.comments')}</th>
                <th style={th}>{t('emp.handoffs')}</th>
                <th style={th}>{t('emp.turnaround')}</th>
                <th style={th}>{t('emp.score')}</th>
              </tr>
            </thead>
            <tbody>
              {data == null ? (
                <tr><td style={tdL} colSpan={6}>{t('emp.loading')}</td></tr>
              ) : data.members.length === 0 ? (
                <tr><td style={{ ...tdL, color: 'var(--muted)' }} colSpan={6}>{t('emp.noData')}</td></tr>
              ) : data.members.map((m) => (
                <tr key={`${m.memberKind}:${m.memberRef}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={tdL}>{m.name}</td>
                  <td style={td}>{m.prsReviewed}</td>
                  <td style={td}>{m.reviewComments}</td>
                  <td style={td}>{m.handoffs}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{hrs(m.avgReviewTurnaroundHours)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{int(m.collaborationScore)}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </div>
      </div>
    </div>
  );
}

// ── EMP-17 — documentation activity ──────────────────────────────────────────
function DocActivityPanel({ days }: { days: number }) {
  const t = useTranslations('widgets');
  const [data, setData] = useState<DocActivityResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { empMetricsApi.docActivity(days).then(setData).catch((e: Error) => setErr(e.message)); }, [days]);

  return (
    <div style={card}>
      <PanelHeader title={t('emp.docTitle')} />
      {err && <div style={{ color: DANGER, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <ScrollTable>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <th style={thL}>{t('emp.member')}</th>
            <th style={th}>{t('emp.authored')}</th>
            <th style={th}>{t('emp.edits')}</th>
            <th style={th}>{t('emp.acks')}</th>
            <th style={th}>{t('emp.score')}</th>
          </tr>
        </thead>
        <tbody>
          {data == null ? (
            <tr><td style={tdL} colSpan={5}>{t('emp.loading')}</td></tr>
          ) : data.members.length === 0 ? (
            <tr><td style={{ ...tdL, color: 'var(--muted)' }} colSpan={5}>{t('emp.noData')}</td></tr>
          ) : data.members.map((m) => (
            <tr key={m.memberRef} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={tdL}>{m.name}</td>
              <td style={td}>{m.docsAuthored}</td>
              <td style={td}>{m.edits}</td>
              <td style={td}>{m.acksGiven}</td>
              <td style={{ ...td, fontWeight: 700 }}>{int(m.score)}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </div>
  );
}

// ── EMP-19 — labour cost ─────────────────────────────────────────────────────
function LaborCostPanel({ days }: { days: number }) {
  const t = useTranslations('widgets');
  const [data, setData] = useState<LaborCostResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { empMetricsApi.laborCost(days).then(setData).catch((e: Error) => setErr(e.message)); }, [days]);

  const projBars: BarDatum[] = (data?.byProject ?? []).slice(0, 8).map((p, i) => ({ key: p.id, label: p.name, value: p.costUsd, color: colorAt(i) }));
  const initBars: BarDatum[] = (data?.byInitiative ?? []).slice(0, 8).map((p, i) => ({ key: p.id, label: p.name, value: p.costUsd, color: colorAt(i) }));

  return (
    <div style={card}>
      <PanelHeader title={t('emp.costTitle')} />
      {err && <div style={{ color: DANGER, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {data && (
        <>
          <div style={{ marginBottom: 12 }}>
            <InsightStat label={t('emp.totalCost')} value={usd(data.totalUsd)} style={{ minWidth: 170 }} />
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{t('emp.project')}</div>
              {projBars.length ? <BarChart data={projBars} formatValue={(v) => usd(v)} ariaLabel={t('emp.project')} /> : <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('emp.noData')}</div>}
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{t('emp.initiative')}</div>
              {initBars.length ? <BarChart data={initBars} formatValue={(v) => usd(v)} ariaLabel={t('emp.initiative')} /> : <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('emp.noData')}</div>}
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <ScrollTable>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th style={thL}>{t('emp.member')}</th>
                  <th style={th}>{t('emp.effortH')}</th>
                  <th style={th}>{t('emp.tasks')}</th>
                  <th style={th}>{t('emp.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {data.byMember.length === 0 ? (
                  <tr><td style={{ ...tdL, color: 'var(--muted)' }} colSpan={4}>{t('emp.noData')}</td></tr>
                ) : data.byMember.map((m) => (
                  <tr key={`${m.memberKind}:${m.memberRef}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={tdL}>{m.name}</td>
                    <td style={td}>{m.effortHours.toFixed(1)}</td>
                    <td style={td}>{m.taskCount}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{usd(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </ScrollTable>
          </div>
        </>
      )}
    </div>
  );
}

// ── EMP-16 — performer tiers + coaching ──────────────────────────────────────
const TIER_COLOR: Record<PerformerTier, string> = { high: OK, solid: 'var(--accent, #6366f1)', watch: DANGER };

function CoachingNotes({ member }: { member: PerformerRow }) {
  const t = useTranslations('widgets');
  const [notes, setNotes] = useState<CoachingNote[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = () => empMetricsApi.coachingNotes(member.memberKind, member.memberRef).then((r) => setNotes(r.notes)).catch(() => setNotes([]));
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [member.memberKind, member.memberRef]);

  const save = async () => {
    const note = draft.trim();
    if (!note) return;
    setBusy(true);
    try { await empMetricsApi.addCoachingNote(member.memberKind, member.memberRef, note); setDraft(''); await reload(); }
    finally { setBusy(false); }
  };
  const remove = async (id: number) => { await empMetricsApi.deleteCoachingNote(id); await reload(); };

  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8, marginTop: 6 }}>
      {notes == null ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('emp.loading')}</div>
      ) : notes.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{t('emp.noNotes')}</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {notes.map((n) => (
            <li key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
              <span style={{ flex: 1 }}>{n.note}</span>
              <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{new Date(n.createdAt).toLocaleDateString()}</span>
              <button onClick={() => remove(n.id)} style={{ background: 'none', border: 'none', color: DANGER, cursor: 'pointer', fontSize: 11 }}>{t('emp.deleteNote')}</button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder={t('emp.notePlaceholder')}
          style={{ flex: 1, padding: '6px 10px', borderRadius: 8, fontSize: 12, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
        />
        <button onClick={save} disabled={busy || !draft.trim()} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'var(--accent, #6366f1)', color: '#fff', opacity: busy || !draft.trim() ? 0.6 : 1 }}>
          {t('emp.saveNote')}
        </button>
      </div>
    </div>
  );
}

function PerformersPanel({ days }: { days: number }) {
  const t = useTranslations('widgets');
  const [data, setData] = useState<PerformerTiersResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { empMetricsApi.performerTiers(days).then(setData).catch((e: Error) => setErr(e.message)); }, [days]);

  const tierLabel = (tier: PerformerTier) => t(`emp.tier${tier[0].toUpperCase()}${tier.slice(1)}` as 'emp.tierHigh');

  return (
    <div style={card}>
      <PanelHeader title={t('emp.performersTitle')} />
      {err && <div style={{ color: DANGER, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {data && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {(['high', 'solid', 'watch'] as PerformerTier[]).map((tier) => (
            <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontSize: 12, border: '1px solid var(--border-subtle)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: TIER_COLOR[tier] }} />
              <span style={{ fontWeight: 600 }}>{tierLabel(tier)}</span>
              <span style={{ color: 'var(--muted)' }}>{data.counts[tier]}</span>
            </div>
          ))}
        </div>
      )}
      <ScrollTable>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <th style={thL}>{t('emp.member')}</th>
            <th style={th}>{t('emp.tier')}</th>
            <th style={th}>{t('emp.percentile')}</th>
            <th style={th}>{t('emp.composite')}</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {data == null ? (
            <tr><td style={tdL} colSpan={5}>{t('emp.loading')}</td></tr>
          ) : data.members.length === 0 ? (
            <tr><td style={{ ...tdL, color: 'var(--muted)' }} colSpan={5}>{t('emp.noData')}</td></tr>
          ) : data.members.map((m) => {
            const key = `${m.memberKind}:${m.memberRef}`;
            return (
              <Fragment key={key}>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={tdL}>{m.name}</td>
                  <td style={td}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: TIER_COLOR[m.tier], padding: '1px 8px', borderRadius: 999 }}>{tierLabel(m.tier)}</span>
                  </td>
                  <td style={td}>{pct(m.percentile)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{int(m.composite)}</td>
                  <td style={td}>
                    <button onClick={() => setOpen(open === key ? null : key)} style={{ background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '2px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      {t('emp.addNote')}
                    </button>
                  </td>
                </tr>
                {open === key && (
                  <tr>
                    <td colSpan={5} style={{ padding: '0 10px 10px' }}><CoachingNotes member={m} /></td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </ScrollTable>
    </div>
  );
}

// ── EMP-13 — per-member initiative allocation (stacked) ──────────────────────
function InitiativeAllocationPanel({ days }: { days: number }) {
  const t = useTranslations('widgets');
  const [data, setData] = useState<MemberInitiativeAllocResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { empMetricsApi.initiativeAllocation(days).then(setData).catch((e: Error) => setErr(e.message)); }, [days]);

  const colorByInit = new Map<string, string>();
  (data?.initiatives ?? []).forEach((i, idx) => colorByInit.set(i.id, i.id === 'unassigned' ? 'var(--border-subtle)' : colorAt(idx)));

  return (
    <div style={card}>
      <PanelHeader title={t('emp.initiativesTitle')} />
      {err && <div style={{ color: DANGER, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {data && data.initiatives.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          {data.initiatives.map((i) => (
            <span key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: colorByInit.get(i.id) }} />
              {i.name}
            </span>
          ))}
        </div>
      )}
      {data == null ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('emp.loading')}</div>
      ) : data.members.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('emp.noData')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.members.map((m) => (
            <div key={`${m.memberKind}:${m.memberRef}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{m.name}</span>
                <span style={{ color: 'var(--muted)' }}>{m.totalHours.toFixed(1)}h · {m.initiativeCount} {t('emp.focusMix')}</span>
              </div>
              <div style={{ display: 'flex', height: 20, borderRadius: 6, overflow: 'hidden', background: 'var(--border-subtle)' }} title={m.slices.map((s) => `${s.initiativeName} ${s.pct}%`).join(' · ')}>
                {m.slices.map((s) => (
                  <div key={s.initiativeId} style={{ width: `${s.pct}%`, background: colorByInit.get(s.initiativeId) ?? colorAt(0) }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmpMetricsView() {
  const t = useTranslations('widgets');
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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '4px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border-subtle)',
              background: days === d ? 'var(--accent, #6366f1)' : 'var(--bg-base)', color: days === d ? '#fff' : 'var(--text-secondary)',
            }}>{d}d</button>
          ))}
          <button onClick={doExport} disabled={exporting} style={{
            padding: '4px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)', color: 'var(--text-secondary)', opacity: exporting ? 0.6 : 1,
          }}>{exporting ? t('emp.exporting') : t('emp.exportCsv')}</button>
        </div>
      </div>

      <AllocationPanel />
      <CollaborationPanel days={days} />
      <DocActivityPanel days={days} />
      <LaborCostPanel days={days} />
      <PerformersPanel days={days} />
      <InitiativeAllocationPanel days={days} />
    </div>
  );
}
