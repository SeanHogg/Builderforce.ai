'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  governanceApi,
  type StakeholderAnswer,
  type StakeholderDashboard,
  type StakeholderMapEntry,
  type StakeholderQuestionKey,
} from '@/lib/builderforceApi';

const QUESTIONS: Array<{ key: StakeholderQuestionKey; label: string }> = [
  { key: 'priorities_clear', label: 'Priorities are clear and agreed' },
  { key: 'competing_p0s_reconciled', label: 'Competing P0s are reconciled' },
  { key: 'approvers_current', label: 'Required approvers are current' },
  { key: 'conflicts_within_sla', label: 'Conflicts are within the 48-hour SLA' },
  { key: 'delivery_reflects_priorities', label: 'Delivery reflects agreed priorities' },
];

const EMPTY_ANSWERS: Record<StakeholderQuestionKey, StakeholderAnswer> = {
  priorities_clear: 'unknown',
  competing_p0s_reconciled: 'unknown',
  approvers_current: 'unknown',
  conflicts_within_sla: 'unknown',
  delivery_reflects_priorities: 'unknown',
};

const card: React.CSSProperties = {
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16, background: 'var(--bg-base)',
};
const input: React.CSSProperties = {
  minWidth: 130, flex: 1, padding: '7px 9px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--surface-interactive)', color: 'var(--text-primary)',
};

export function StakeholderAlignmentPanel({ projectId }: { projectId: number }) {
  const [dashboard, setDashboard] = useState<StakeholderDashboard | null>(null);
  const [stakeholders, setStakeholders] = useState<StakeholderMapEntry[]>([]);
  const [answers, setAnswers] = useState(EMPTY_ANSWERS);
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
  const [role, setRole] = useState<StakeholderMapEntry['role']>('required_approver');
  const [teamScope, setTeamScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [dashboardResult, mapResult, profileResult] = await Promise.all([
        governanceApi.stakeholder.dashboard(projectId),
        governanceApi.stakeholder.map(projectId),
        governanceApi.stakeholder.healthProfile(projectId),
      ]);
      setDashboard(dashboardResult);
      setStakeholders(mapResult.stakeholders);
      if (profileResult.profile) setAnswers(profileResult.profile.answers);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load stakeholder alignment');
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function addStakeholder() {
    if (!name.trim() || !ref.trim()) return;
    setBusy(true);
    try {
      await governanceApi.stakeholder.upsertMapEntry(projectId, {
        displayName: name.trim(), stakeholderRef: ref.trim(), role, teamScope: teamScope.trim() || null, priority: null,
      });
      setName(''); setRef(''); setTeamScope('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save stakeholder');
    } finally { setBusy(false); }
  }

  async function saveHealth() {
    setBusy(true);
    try {
      await governanceApi.stakeholder.saveHealthProfile(projectId, answers);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save health profile');
    } finally { setBusy(false); }
  }

  async function removeStakeholder(id: string) {
    setBusy(true);
    try {
      await governanceApi.stakeholder.removeMapEntry(id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to remove stakeholder');
    } finally { setBusy(false); }
  }

  return (
    <section style={card} aria-labelledby="stakeholder-alignment-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 id="stakeholder-alignment-title" style={{ fontSize: 'var(--font-size-body)', margin: 0 }}>Stakeholder alignment</h3>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>Agree priorities, collect sign-off, and surface conflicts before delivery drifts.</p>
        </div>
        {dashboard ? (
          <div style={{ display: 'flex', gap: 10, fontSize: 'var(--font-size-small)', flexWrap: 'wrap' }}>
            <span>{dashboard.approved} approved</span><span>{dashboard.pending} pending</span>
            <span style={{ color: dashboard.overdue ? 'var(--error)' : 'var(--text-muted)' }}>{dashboard.overdue} overdue</span>
            <span style={{ color: dashboard.activeConflicts ? 'var(--warning)' : 'var(--text-muted)' }}>{dashboard.activeConflicts} conflicts</span>
          </div>
        ) : null}
      </div>

      {error ? <div role="alert" style={{ marginTop: 10, color: 'var(--error)', fontSize: 'var(--font-size-small)' }}>{error}</div> : null}
      {dashboard?.digest ? <p style={{ margin: '12px 0', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{dashboard.digest}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginTop: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 'var(--font-size-small)', marginBottom: 8 }}>Stakeholder map</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stakeholders.length === 0 ? <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>No stakeholders configured.</span> : stakeholders.map((stakeholder) => (
              <div key={stakeholder.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-size-small)' }}>
                <span style={{ flex: 1 }}><strong>{stakeholder.displayName}</strong> · {stakeholder.role === 'required_approver' ? 'Approver' : 'Informed'}{stakeholder.teamScope ? ` · ${stakeholder.teamScope}` : ''}</span>
                <button type="button" disabled={busy} aria-label={`Remove ${stakeholder.displayName}`} onClick={() => void removeStakeholder(stakeholder.id)} style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>×</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            <input aria-label="Stakeholder name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" style={input} />
            <input aria-label="Stakeholder user reference" value={ref} onChange={(event) => setRef(event.target.value)} placeholder="User ID" style={input} />
            <input aria-label="Team scope" value={teamScope} onChange={(event) => setTeamScope(event.target.value)} placeholder="Team (optional)" style={input} />
            <select aria-label="Stakeholder role" value={role} onChange={(event) => setRole(event.target.value as StakeholderMapEntry['role'])} style={input}>
              <option value="required_approver">Required approver</option><option value="informed">Informed</option>
            </select>
            <button type="button" disabled={busy || !name.trim() || !ref.trim()} onClick={() => void addStakeholder()} style={{ ...input, flex: 0, cursor: 'pointer', fontWeight: 700 }}>Add</button>
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 700, fontSize: 'var(--font-size-small)', marginBottom: 8 }}>Alignment health</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {QUESTIONS.map((question) => (
              <label key={question.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 'var(--font-size-small)' }}>
                <span>{question.label}</span>
                <select value={answers[question.key]} onChange={(event) => setAnswers((current) => ({ ...current, [question.key]: event.target.value as StakeholderAnswer }))} style={{ ...input, minWidth: 92, flex: 0 }}>
                  <option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option>
                </select>
              </label>
            ))}
          </div>
          <button type="button" disabled={busy} onClick={() => void saveHealth()} style={{ ...input, marginTop: 10, cursor: 'pointer', fontWeight: 700 }}>Save health profile</button>
        </div>
      </div>
    </section>
  );
}
