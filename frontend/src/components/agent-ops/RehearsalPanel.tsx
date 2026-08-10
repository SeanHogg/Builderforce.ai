'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
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
import { button, card, cardGrid, chip, emptyState, input, mono, muted, option, sectionTitle, table, tableScroll, td, th } from './agentOpsStyles';

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
      setError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setRunning(false);
    }
  };

  const openReport = async (id: string) => setReport(await getRehearsalReport(id));
  const toggleComparison = (id: string) => setComparisonIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current.slice(-1), id]);
  const openComparison = async () => {
    if (comparisonIds.length !== 2) return;
    setComparison(await compareRehearsals(comparisonIds[0]!, comparisonIds[1]!));
  };

  const kindLabel = (k: RehearsalKind): string =>
    k === 'replay' ? t('rehearsal.kindReplay') : k === 'trial' ? t('rehearsal.kindTrial') : t('rehearsal.kindDryRun');

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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <button type="button" style={button('primary')} disabled={comparisonIds.length !== 2} onClick={() => void openComparison()}>
            {t('rehearsal.compareSelected', { count: comparisonIds.length })}
          </button>
          <span style={muted}>{t('rehearsal.compareHint')}</span>
        </div>
        {rows == null ? (
          <p style={muted}>{t('loading')}</p>
        ) : rows.length === 0 ? (
          <div style={{ ...emptyState, marginTop: 12 }}>{t('rehearsal.empty')}</div>
        ) : (
          <div style={{ ...tableScroll, marginTop: 12 }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>{t('rehearsal.kind')}</th>
                  <th style={th}>{t('rehearsal.ticket')}</th>
                  <th style={th}>{t('rehearsal.agent')}</th>
                  <th style={th}>{t('rehearsal.wouldWrite')}</th>
                  <th style={th}>{t('rehearsal.outcome')}</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td}><span style={chip('accent')}>{kindLabel(r.kind)}</span></td>
                    <td style={td}>{r.taskId ? `#${r.taskId} ${r.taskTitle ?? ''}` : '—'}</td>
                    <td style={td}>{r.agentLabel}</td>
                    <td style={td}>
                      <strong>{r.suppressedWrites}</strong>
                      <span style={muted}> / {t('rehearsal.stepCount', { count: r.steps })}</span>
                    </td>
                    <td style={td}>
                      {r.status === 'failed' ? (
                        <span style={chip('warn')}>{t('rehearsal.failed')}</span>
                      ) : r.finishedOk ? (
                        <span style={chip('good')}>{t('rehearsal.finished')}</span>
                      ) : (
                        <span style={chip()}>{t('rehearsal.unfinished')}</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button type="button" style={button(comparisonIds.includes(r.id) ? 'primary' : 'ghost')} aria-pressed={comparisonIds.includes(r.id)} onClick={() => toggleComparison(r.id)}>
                        {comparisonIds.includes(r.id) ? t('rehearsal.selected') : t('rehearsal.selectCompare')}
                      </button>{' '}
                      <button type="button" style={button()} onClick={() => void openReport(r.id)}>
                        {t('rehearsal.viewReport')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {report && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ ...sectionTitle, marginBottom: 0 }}>{t('rehearsal.reportTitle')}</h2>
            <button type="button" style={button()} onClick={() => setReport(null)}>{t('close')}</button>
          </div>
          {report.rehearsal.frozenRef && (
            <p style={{ ...muted, marginTop: 8 }}>
              {t('rehearsal.frozenAt')} <span style={mono}>{report.rehearsal.frozenRef}</span>
            </p>
          )}
          {report.rehearsal.summary && (
            <p style={{ ...muted, marginTop: 8, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{report.rehearsal.summary}</p>
          )}
          {report.rehearsal.errorMessage && (
            <p style={{ ...muted, marginTop: 8, color: 'var(--danger)' }}>{report.rehearsal.errorMessage}</p>
          )}
          <h3 style={{ ...sectionTitle, marginTop: 14 }}>{t('rehearsal.suppressedTitle')}</h3>
          {report.steps.length === 0 ? (
            <p style={muted}>{t('rehearsal.noSteps')}</p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}>
              {report.steps.map((s) => (
                <li key={s.seq}>
                  <span style={chip('accent')}>{s.op}</span>{' '}
                  <span style={mono}>{s.target}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {comparison && (
        <div style={card} aria-live="polite">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ ...sectionTitle, marginBottom: 0 }}>{t('rehearsal.comparisonTitle')}</h2>
            <button type="button" style={button()} onClick={() => setComparison(null)}>{t('close')}</button>
          </div>
          <p style={{ ...muted, marginTop: 8 }}>{comparison.sameTicket ? t('rehearsal.sameTicket') : t('rehearsal.differentTicket')} · {comparison.sameFrozenRef ? t('rehearsal.sameRef') : t('rehearsal.differentRef')}</p>
          <div style={{ ...tableScroll, marginTop: 12 }}>
            <table style={table}>
              <thead><tr><th style={th}>{t('rehearsal.operation')}</th><th style={th}>{t('rehearsal.baseline')}</th><th style={th}>{t('rehearsal.candidate')}</th><th style={th}>{t('rehearsal.delta')}</th></tr></thead>
              <tbody>{comparison.operations.map((op) => <tr key={op.op}><td style={td}><span style={mono}>{op.op}</span></td><td style={td}>{op.left}</td><td style={td}>{op.right}</td><td style={td}>{op.delta > 0 ? `+${op.delta}` : op.delta}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
