'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  governanceApi,
  type StakeholderAnswer,
  type StakeholderDashboard,
  type StakeholderMapEntry,
  type StakeholderQuestionKey,
} from '@/lib/builderforceApi';
import { useErrorMessage } from '@/i18n/useErrorMessage';

/** Question order. Labels resolve under `stakeholderAlignment.question.<key>`. */
const QUESTIONS: readonly StakeholderQuestionKey[] = [
  'priorities_clear',
  'competing_p0s_reconciled',
  'approvers_current',
  'conflicts_within_sla',
  'delivery_reflects_priorities',
];

const ANSWERS: readonly StakeholderAnswer[] = ['yes', 'no', 'unknown'];

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
  const t = useTranslations('stakeholderAlignment');
  const errorMessage = useErrorMessage();
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
      setError(errorMessage(cause));
    }
  }, [projectId, errorMessage]);

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
      setError(errorMessage(cause));
    } finally { setBusy(false); }
  }

  async function saveHealth() {
    setBusy(true);
    try {
      await governanceApi.stakeholder.saveHealthProfile(projectId, answers);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally { setBusy(false); }
  }

  async function removeStakeholder(id: string) {
    setBusy(true);
    try {
      await governanceApi.stakeholder.removeMapEntry(id);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally { setBusy(false); }
  }

  return (
    <section style={card} aria-labelledby="stakeholder-alignment-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 id="stakeholder-alignment-title" style={{ fontSize: 'var(--font-size-body)', margin: 0 }}>{t('title')}</h3>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('subtitle')}</p>
        </div>
        {dashboard ? (
          <div style={{ display: 'flex', gap: 10, fontSize: 'var(--font-size-small)', flexWrap: 'wrap' }}>
            <span>{t('approvedCount', { count: dashboard.approved })}</span><span>{t('pendingCount', { count: dashboard.pending })}</span>
            <span style={{ color: dashboard.overdue ? 'var(--error)' : 'var(--text-muted)' }}>{t('overdueCount', { count: dashboard.overdue })}</span>
            <span style={{ color: dashboard.activeConflicts ? 'var(--warning)' : 'var(--text-muted)' }}>{t('conflictsCount', { count: dashboard.activeConflicts })}</span>
          </div>
        ) : null}
      </div>

      {error ? <div role="alert" style={{ marginTop: 10, color: 'var(--error)', fontSize: 'var(--font-size-small)' }}>{error}</div> : null}
      {dashboard?.digest ? <p style={{ margin: '12px 0', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{dashboard.digest}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginTop: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 'var(--font-size-small)', marginBottom: 8 }}>{t('mapTitle')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stakeholders.length === 0 ? <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('noStakeholders')}</span> : stakeholders.map((stakeholder) => (
              <div key={stakeholder.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-size-small)' }}>
                <span style={{ flex: 1 }}><strong>{stakeholder.displayName}</strong> · {stakeholder.role === 'required_approver' ? t('roleApprover') : t('roleInformed')}{stakeholder.teamScope ? ` · ${stakeholder.teamScope}` : ''}</span>
                <button type="button" disabled={busy} aria-label={t('removeAria', { name: stakeholder.displayName })} onClick={() => void removeStakeholder(stakeholder.id)} style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>×</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            <input aria-label={t('nameAria')} value={name} onChange={(event) => setName(event.target.value)} placeholder={t('namePlaceholder')} style={input} />
            <input aria-label={t('refAria')} value={ref} onChange={(event) => setRef(event.target.value)} placeholder={t('refPlaceholder')} style={input} />
            <input aria-label={t('teamAria')} value={teamScope} onChange={(event) => setTeamScope(event.target.value)} placeholder={t('teamPlaceholder')} style={input} />
            <select aria-label={t('roleAria')} value={role} onChange={(event) => setRole(event.target.value as StakeholderMapEntry['role'])} style={input}>
              <option value="required_approver">{t('roleRequiredApprover')}</option><option value="informed">{t('roleInformed')}</option>
            </select>
            <button type="button" disabled={busy || !name.trim() || !ref.trim()} onClick={() => void addStakeholder()} style={{ ...input, flex: 0, cursor: 'pointer', fontWeight: 700 }}>{t('add')}</button>
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 700, fontSize: 'var(--font-size-small)', marginBottom: 8 }}>{t('healthTitle')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {QUESTIONS.map((question) => (
              <label key={question} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 'var(--font-size-small)' }}>
                <span>{t(`question.${question}`)}</span>
                <select value={answers[question]} onChange={(event) => setAnswers((current) => ({ ...current, [question]: event.target.value as StakeholderAnswer }))} style={{ ...input, minWidth: 92, flex: 0 }}>
                  {ANSWERS.map((answer) => <option key={answer} value={answer}>{t(`answer.${answer}`)}</option>)}
                </select>
              </label>
            ))}
          </div>
          <button type="button" disabled={busy} onClick={() => void saveHealth()} style={{ ...input, marginTop: 10, cursor: 'pointer', fontWeight: 700 }}>{t('saveHealth')}</button>
        </div>
      </div>
    </section>
  );
}
