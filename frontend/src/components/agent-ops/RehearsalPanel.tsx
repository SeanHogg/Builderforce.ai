import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { LocalCollection } from '@/components/pm/LocalCollection';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import {
  getRehearsalReport,
  compareRehearsals,
  listRehearsals,
  startRehearsal,
  type Rehearsal,
  type RehearsalKind,
  type RehearsalStep,
  type RehearsalComparison,
} from '@/lib/agentOpsApi';
import { button, card, cardGrid, emptyState, input, muted, option, sectionTitle } from './agentOpsStyles';
import { rehearsalKindLabel, rehearsalsDescriptor } from './agentOpsDescriptors';
import { RehearsalComparisonCard, RehearsalReportCard } from './RehearsalResults';
import { useFormat } from '@/i18n/useFormat';
import { faultMessage } from '@/lib/apiClient';
/**
 * Rehearsal — run an agent for real, and let nothing escape.
 *
 * The report is the product: `suppressedWrites` is the count of commits the agent
 * WOULD have made, and the step list is what each one contained. Read together with
 * "did it finish", that is a prediction of the live run at a fraction of its blast
 * radius — which is what makes changing a prompt, a policy pack or a model pin
 * measurable instead of a guess deployed onto real tickets.
 */
export function RehearsalPanel() {
  const t = useTranslations('agentOps');
  const fmt = useFormat();
  const { currentProjectId } = useProjectScope();
  const [rows, setRows] = useState<Rehearsal[] | null>(null);
  const [kind, setKind] = useState<RehearsalKind>('dry_run');
  const [taskId, setTaskId] = useState('');
  const [agentRef, setAgentRef] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ rehearsal: Rehearsal; steps: RehearsalStep[] } | null>(null);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<RehearsalComparison | null>(null);

  const load = useCallback(async () => {
    const { rehearsals } = await listRehearsals(currentProjectId);
    setRows(rehearsals);
  }, [currentProjectId]);

  useEffect(() => { void load(); }, [load]);

  const onStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setError(null);
    try {
      await startRehearsal({
        kind,
        ...(kind === 'trial' ? { projectId: currentProjectId } : { taskId: Number(taskId) }),
        ...(agentRef ? { agentRef } : {}),
      });
      await load();
    } catch (err) {
      setError(faultMessage(err, t('genericError')));
    } finally {
      setRunning(false);
    }
  };

  const openComparison = async () => {
    if (comparisonIds.length !== 2) return;
    setComparison(await compareRehearsals(comparisonIds[0]!, comparisonIds[1]!));
  };

  const descriptor = useMemo(() => rehearsalsDescriptor(t, fmt, {
    isCompared: (id) => comparisonIds.includes(id),
    onToggleCompare: (id) => setComparisonIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current.slice(-1), id]),
    onOpenReport: (id) => void getRehearsalReport(id).then(setReport),
  }), [t, fmt, comparisonIds]);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <RoleGate capability="agents.manage" variant="block">
        <form onSubmit={onStart} style={{ ...card, display: 'grid', gap: 12 }}>
          <h2 style={sectionTitle}>{t('rehearsal.startTitle')}</h2>
          <div style={cardGrid}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={muted}>{t('rehearsal.kind')}</span>
              <select style={input} value={kind} onChange={(e) => setKind(e.target.value as RehearsalKind)}>
                <option style={option} value="dry_run">{t('rehearsal.kindDryRun')}</option>
                <option style={option} value="trial">{t('rehearsal.kindTrial')}</option>
              </select>
            </label>
            {kind !== 'trial' && (
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={muted}>{t('rehearsal.ticket')}</span>
                <input
                  style={input}
                  inputMode="numeric"
                  value={taskId}
                  onChange={(e) => setTaskId(e.target.value)}
                  placeholder={t('rehearsal.ticketPlaceholder')}
                />
              </label>
            )}
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={muted}>{t('rehearsal.agent')}</span>
              <input
                style={input}
                value={agentRef}
                onChange={(e) => setAgentRef(e.target.value)}
                placeholder={t('rehearsal.agentPlaceholder')}
              />
            </label>
          </div>
          <p style={muted}>{t('rehearsal.startHint')}</p>
          <div>
            <button type="submit" style={button('primary')} disabled={running}>
              {running ? t('rehearsal.running') : t('rehearsal.start')}
            </button>
          </div>
          {error && <p style={{ ...muted, color: 'var(--danger)' }}>{error}</p>}
        </form>
      </RoleGate>

      <div style={card}>
        <h2 style={sectionTitle}>{t('rehearsal.historyTitle')}</h2>
        {rows == null ? (
          <p style={muted}>{t('loading')}</p>
        ) : rows.length === 0 ? (
          <div style={{ ...emptyState, marginTop: 12 }}>{t('rehearsal.empty')}</div>
        ) : (
          <LocalCollection
            descriptor={descriptor}
            rows={rows}
            searchText={(r) => `${rehearsalKindLabel(t, r.kind)} ${r.taskId ?? ''} ${r.taskTitle ?? ''} ${r.agentLabel}`}
          >
            <button type="button" style={button('primary')} disabled={comparisonIds.length !== 2} onClick={() => void openComparison()}>
              {t('rehearsal.compareSelected', { count: comparisonIds.length })}
            </button>
            <span style={muted}>{t('rehearsal.compareHint')}</span>
          </LocalCollection>
        )}
      </div>

      {report && <RehearsalReportCard report={report} onClose={() => setReport(null)} />}
      {comparison && <RehearsalComparisonCard comparison={comparison} onClose={() => setComparison(null)} />}
    </div>
  );
}
