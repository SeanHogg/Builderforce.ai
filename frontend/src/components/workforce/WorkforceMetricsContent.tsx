import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { membersApi, empMetricsApi, type DisciplineRollup, type DoraRollup, type MemberScorecard } from '@/lib/builderforceApi';
import { LocalCollection } from '@/components/pm/LocalCollection';
import { MemberProfileEditor } from './MemberProfileEditor';
import { AssigneeProfilesProvider } from './AssigneeProfilesContext';
import { EngagementSection } from './EngagementSection';
import { fmtHrs, fmtScore, scoreColor } from './workforceFormat';
import { DISCIPLINE_OPTIONS, useDisciplineLabel, useScorecardDescriptor } from './performanceCollections';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { useErrorMessage } from '@/i18n/useErrorMessage';

/**
 * Performance tab — workforce effectiveness/engagement scorecards (humans AND
 * agents) + the four DORA metrics. Reads /api/members/metrics and /dora. Each
 * scorecard member opens the capability/availability profile editor (the
 * planner's inputs). MANAGER+ on the API; non-managers get an empty/forbidden
 * state. The scorecards render through the ONE Collection (PRD 47).
 */

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16,
};

function DoraTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ ...cardStyle, flex: '1 1 160px', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const memberSearch = (m: MemberScorecard) => `${m.memberName} ${m.discipline ?? ''}`;

export function WorkforceMetricsContent() {
  const errorMessage = useErrorMessage();
  const t = useTranslations('workforce');
  const tw = useTranslations('components');
  const [days, setDays] = useState(7);
  const [discipline, setDiscipline] = useState('');
  const [members, setMembers] = useState<MemberScorecard[] | null>(null);
  const [byDiscipline, setByDiscipline] = useState<DisciplineRollup[]>([]);
  const [dora, setDora] = useState<DoraRollup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemberScorecard | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const disciplineLabel = useDisciplineLabel();
  const scorecardDescriptor = useScorecardDescriptor(setEditing);
  // The global project scope reaches the server (it takes `projectId` on all three).
  const { currentProjectId } = useProjectScope();

  const doExport = async () => {
    setExporting(true);
    // Export the scope on screen, not a workspace file that merely resembles it.
    try { await empMetricsApi.exportMetrics(days, 'csv', currentProjectId); } catch { /* surfaced via global toast */ }
    finally { setExporting(false); }
  };

  useEffect(() => {
    membersApi.metrics(days, discipline || undefined, currentProjectId)
      .then((r) => { setMembers(r.members); setByDiscipline(r.byDiscipline); })
      .catch((e: unknown) => setError(errorMessage(e)));
    membersApi.dora(Math.max(days, 30), currentProjectId).then(setDora).catch(() => { /* optional */ });
  }, [days, discipline, reloadKey, currentProjectId, errorMessage]);

  return (
    // ONE fetch of the tenant's personality map for the whole collection — the same
    // provider the board mounts, so a hovercard costs no per-row request.
    <AssigneeProfilesProvider>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{t('performance.title')}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {[7, 14, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '4px 10px', borderRadius: 'var(--radius-md)', fontSize: 12, cursor: 'pointer',
              border: '1px solid var(--border-subtle)',
              background: days === d ? 'var(--accent)' : 'var(--bg-base)',
              color: days === d ? 'var(--text-on-accent)' : 'var(--text-secondary)',
            }}>{t('performance.daysShort', { days: d })}</button>
          ))}
          <button onClick={doExport} disabled={exporting} title={tw('emp.exportCsv')} style={{
            padding: '4px 12px', borderRadius: 'var(--radius-md)', fontSize: 12, cursor: 'pointer',
            border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
            color: 'var(--text-secondary)', opacity: exporting ? 0.6 : 1,
          }}>{exporting ? tw('emp.exporting') : tw('emp.exportCsv')}</button>
        </div>
      </div>

      {/* DORA */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <DoraTile
          label={t('performance.dora.deployFreq')}
          value={dora ? t('performance.dora.perDay', { n: dora.deploymentFrequencyPerDay.toFixed(2) }) : '—'}
          hint={dora ? t('performance.dora.deploysIn', { count: dora.totalDeployments, days: dora.windowDays }) : undefined}
        />
        <DoraTile label={t('performance.dora.leadTime')} value={fmtHrs(dora?.leadTimeHours ?? null)} hint={t('performance.dora.leadTimeHint')} />
        <DoraTile label={t('performance.dora.cfr')} value={dora?.changeFailureRatePct == null ? '—' : `${dora.changeFailureRatePct.toFixed(0)}%`} hint={t('performance.dora.cfrHint')} />
        <DoraTile label={t('performance.dora.mttr')} value={fmtHrs(dora?.mttrHours ?? null)} hint={t('performance.dora.mttrHint')} />
      </div>

      {/* Scorecards */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
          {t('performance.scorecards')} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{t('performance.scorecardsSub', { days })}</span>
        </div>
        {/* Discipline rollup chips (computed from the full, unfiltered set). */}
        {byDiscipline.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {byDiscipline.map((b) => (
              <div key={b.discipline} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 12, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontWeight: 600 }}>{disciplineLabel(b.discipline)}</span>
                <span style={{ color: 'var(--muted)' }}>{t('performance.rollupCounts', { members: b.memberCount, completed: b.completedCount })}</span>
                <span style={{ fontWeight: 700, color: scoreColor(b.avgEffectiveness) }}>{fmtScore(b.avgEffectiveness)}</span>
              </div>
            ))}
          </div>
        )}
        {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        {members == null ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('performance.loading')}</div>
        ) : (
          <LocalCollection descriptor={scorecardDescriptor} rows={members} searchText={memberSearch}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('discipline')}</span>
              <Select
                value={discipline}
                onChange={(e) => setDiscipline(e.target.value)}
                style={{ padding: '4px 10px', borderRadius: 'var(--radius-md)', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-secondary)' }}
              >
                <option value="">{t('allDisciplines')}</option>
                {DISCIPLINE_OPTIONS.map((d) => <option key={d} value={d}>{t(`disciplineOptions.${d}`)}</option>)}
                <option value="unassigned">{t('unassigned')}</option>
              </Select>
            </label>
          </LocalCollection>
        )}
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
    </AssigneeProfilesProvider>
  );
}
