'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { membersApi, empMetricsApi, type DisciplineRollup, type DoraRollup, type MemberScorecard } from '@/lib/builderforceApi';
import { MemberProfileEditor } from './MemberProfileEditor';
import { EngagementSection } from './EngagementSection';
import { fmtHrs, fmtScore, scoreColor, MEMBER_KIND_LABEL } from './workforceFormat';

const DISCIPLINE_OPTIONS = ['engineering', 'product', 'design', 'qa', 'devops', 'data', 'other'] as const;

/**
 * Performance tab — workforce effectiveness/engagement scorecards (humans AND
 * agents) + the four DORA metrics. Reads /api/members/metrics and /dora. Each
 * scorecard row opens the capability/availability profile editor (the planner's
 * inputs). MANAGER+ on the API; non-managers get an empty/forbidden state.
 */

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};

const KIND_LABEL = MEMBER_KIND_LABEL;

function DoraTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ ...cardStyle, flex: '1 1 160px', minWidth: 160 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 11, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 13, whiteSpace: 'nowrap' };

export function WorkforceMetricsContent() {
  const t = useTranslations('workforce');
  const tw = useTranslations('widgets');
  const [days, setDays] = useState(7);
  const [discipline, setDiscipline] = useState('');
  const [members, setMembers] = useState<MemberScorecard[] | null>(null);
  const [byDiscipline, setByDiscipline] = useState<DisciplineRollup[]>([]);
  const [dora, setDora] = useState<DoraRollup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemberScorecard | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);

  const doExport = async () => {
    setExporting(true);
    try { await empMetricsApi.exportMetrics(days, 'csv'); } catch { /* surfaced via global toast */ }
    finally { setExporting(false); }
  };

  useEffect(() => {
    membersApi.metrics(days, discipline || undefined)
      .then((r) => { setMembers(r.members); setByDiscipline(r.byDiscipline); })
      .catch((e: Error) => setError(e.message));
    membersApi.dora(Math.max(days, 30)).then(setDora).catch(() => { /* optional */ });
  }, [days, discipline, reloadKey]);

  // Localized label for a discipline value (falls back to the raw value / unassigned).
  const disciplineLabel = (d: string | null): string => {
    if (!d) return t('unassigned');
    return (DISCIPLINE_OPTIONS as readonly string[]).includes(d) ? t(`disciplineOptions.${d}`) : d;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{t('performance.title')}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {[7, 14, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '4px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
              border: '1px solid var(--border-subtle)',
              background: days === d ? 'var(--accent, #6366f1)' : 'var(--bg-base)',
              color: days === d ? '#fff' : 'var(--text-secondary)',
            }}>{d}d</button>
          ))}
          <button onClick={doExport} disabled={exporting} title={tw('emp.exportCsv')} style={{
            padding: '4px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
            border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
            color: 'var(--text-secondary)', opacity: exporting ? 0.6 : 1,
          }}>{exporting ? tw('emp.exporting') : tw('emp.exportCsv')}</button>
        </div>
      </div>

      {/* DORA */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <DoraTile label="Deployment frequency" value={dora ? `${dora.deploymentFrequencyPerDay.toFixed(2)}/day` : '—'} hint={dora ? `${dora.totalDeployments} in ${dora.windowDays}d` : undefined} />
        <DoraTile label="Lead time for changes" value={fmtHrs(dora?.leadTimeHours ?? null)} hint="created → done" />
        <DoraTile label="Change failure rate" value={dora?.changeFailureRatePct == null ? '—' : `${dora.changeFailureRatePct.toFixed(0)}%`} hint="failed deploys" />
        <DoraTile label="MTTR" value={fmtHrs(dora?.mttrHours ?? null)} hint="restore time" />
      </div>

      {/* Scorecards */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{t('performance.scorecards')} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{t('performance.scorecardsSub', { days })}</span></div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('discipline')}</span>
            <Select
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value)}
              style={{ padding: '4px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-secondary)' }}
            >
              <option value="">{t('allDisciplines')}</option>
              {DISCIPLINE_OPTIONS.map((d) => <option key={d} value={d}>{t(`disciplineOptions.${d}`)}</option>)}
              <option value="unassigned">{t('unassigned')}</option>
            </Select>
          </div>
        </div>
        {/* Discipline rollup chips (computed from the full, unfiltered set). */}
        {byDiscipline.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {byDiscipline.map((b) => (
              <div key={b.discipline} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontSize: 12, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontWeight: 600 }}>{disciplineLabel(b.discipline === 'unassigned' ? null : b.discipline)}</span>
                <span style={{ color: 'var(--muted)' }}>{b.memberCount} · {b.completedCount}✓</span>
                <span style={{ fontWeight: 700, color: scoreColor(b.avgEffectiveness) }}>{fmtScore(b.avgEffectiveness)}</span>
              </div>
            ))}
          </div>
        )}
        {error && <div style={{ color: 'var(--danger, #e5484d)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ ...th, textAlign: 'left' }}>{t('performance.colMember')}</th>
                <th style={{ ...th, textAlign: 'left' }}>{t('discipline')}</th>
                <th style={th}>{t('performance.colAssigned')}</th>
                <th style={th}>{t('performance.colCompleted')}</th>
                <th style={th}>{t('performance.colRedo')}</th>
                <th style={th}>{t('performance.colReopen')}</th>
                <th style={th}>{t('performance.colCycle')}</th>
                <th style={th}>{t('performance.colPickup')}</th>
                <th style={th}>{t('performance.colIdleDone')}</th>
                <th style={th}>{t('performance.colHygiene')}</th>
                <th style={th}>{t('performance.colEngage')}</th>
                <th style={th}>{t('performance.colEffective')}</th>
              </tr>
            </thead>
            <tbody>
              {members == null ? (
                <tr><td style={{ ...td, textAlign: 'left', color: 'var(--muted)' }} colSpan={12}>{t('performance.loading')}</td></tr>
              ) : members.length === 0 ? (
                <tr><td style={{ ...td, textAlign: 'left', color: 'var(--muted)' }} colSpan={12}>{t('performance.noActivity')}</td></tr>
              ) : members.map((m) => (
                <tr key={`${m.memberKind}:${m.memberRef}`} onClick={() => setEditing(m)}
                  style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <div style={{ fontWeight: 500 }}>{m.memberName}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{KIND_LABEL[m.memberKind]}</div>
                  </td>
                  <td style={{ ...td, textAlign: 'left', color: m.discipline ? undefined : 'var(--muted)' }}>{m.discipline ? disciplineLabel(m.discipline) : '—'}</td>
                  <td style={td}>{m.assignedCount}</td>
                  <td style={td}>{m.completedCount}</td>
                  <td style={{ ...td, color: m.redoCount > 0 ? 'var(--warning, #f5a623)' : undefined }}>{m.redoCount}</td>
                  <td style={{ ...td, color: m.reopenCount > 0 ? 'var(--danger, #e5484d)' : undefined }}>{m.reopenCount}</td>
                  <td style={td}>{fmtHrs(m.avgCycleTimeHours)}</td>
                  <td style={td}>{fmtHrs(m.avgPickupLatencyHours)}</td>
                  <td style={td}>{fmtHrs(m.avgIdleAfterDoneHours)}</td>
                  <td style={{ ...td, color: scoreColor(m.boardHygieneScore) }}>{fmtScore(m.boardHygieneScore)}</td>
                  <td style={{ ...td, color: scoreColor(m.engagementScore) }}>{fmtScore(m.engagementScore)}</td>
                  <td style={{ ...td, fontWeight: 700, color: scoreColor(m.effectivenessScore) }}>{fmtScore(m.effectivenessScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unified engagement — all signals folded into one score per member. */}
      <EngagementSection days={days} />

      {editing && (
        <MemberProfileEditor
          kind={editing.memberKind}
          refId={editing.memberRef}
          name={editing.memberName}
          onClose={() => setEditing(null)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
