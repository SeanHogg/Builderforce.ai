'use client';

import { Icon } from '@/components/ui/Icon';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { RoleGate } from '@/components/RoleGate';
import { useBrainDataRefresh } from '@/lib/brain/useBrainDataRefresh';
import {
  workflowDefinitions,
  type WorkflowDefinitionSummary,
  type WorkflowRunTarget,
} from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { WorkflowRunHistoryPanel } from './WorkflowRunHistoryPanel';
import { ViewToggle, type ViewMode } from './ViewToggle';
import { tableWrapStyle, tableStyle } from './dataTableStyles';
import { cardStyle, subtleBtn, StatusPill } from './workflowRunUi';
import { useFormat } from "@/i18n/useFormat";

interface WorkflowsContentProps {
  projectId?: number | null;
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 18px',
  fontSize: '0.875rem',
  fontWeight: 600,
  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
  color: 'var(--text-on-accent)',
  border: 'none',
  borderRadius: 'var(--radius-lg)',
  cursor: 'pointer',
  fontFamily: 'var(--font-display)',
  boxShadow: '0 4px 14px var(--shadow-coral-mid)',
};

/** Derive the saved run target from a definition summary, so the list can fire a
 *  run with the workflow's own assigned agent (no extra round-trip). */
function savedRunTarget(def: WorkflowDefinitionSummary): WorkflowRunTarget {
  return def.runTargetRuntime === 'cloud'
    ? { runtime: 'cloud', cloudAgentRef: def.runTargetCloudAgentRef ?? null }
    : { runtime: 'host', agentHostId: def.runTargetAgentHostId ?? null };
}

/** Has the workflow got an agent assigned? Every workflow needs one to run. */
function hasAgent(def: WorkflowDefinitionSummary): boolean {
  return def.runTargetRuntime === 'cloud' ? !!def.runTargetCloudAgentRef : !!def.runTargetAgentHostId;
}

/** Run-history rollup line ("12 runs · last completed") — shared by card + row. */
function RunStats({ def }: { def: WorkflowDefinitionSummary }) {
  const t = useTranslations('workflowsContent');
  const count = def.runCount ?? 0;
  if (count === 0) return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('noRunsYet')}</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
      {t('runCount', { count })}
      {def.lastRunStatus && <>· {t('last')} <StatusPill status={def.lastRunStatus} /></>}
    </span>
  );
}

/** The project / tenant-wide scope chip — one source of truth for both views. */
function ScopeChip({ def }: { def: WorkflowDefinitionSummary }) {
  const t = useTranslations('workflowsContent');
  const bound = def.projectId != null;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        background: bound ? 'var(--surface-coral-soft, rgba(244,114,94,0.12))' : 'var(--surface-interactive)',
        color: bound ? 'var(--coral-bright)' : 'var(--text-muted)',
        whiteSpace: 'nowrap',
      }}
    >
      {bound ? (def.projectName ?? t('projectNumber', { id: def.projectId ?? 0 })) : t('tenantWide')}
    </span>
  );
}

/** The assigned-agent label — coral when set, a warning when unassigned (every
 *  workflow needs an agent to execute). Shared by card + table. */
function AgentLabel({ def }: { def: WorkflowDefinitionSummary }) {
  const t = useTranslations('workflowsContent');
  if (hasAgent(def)) {
    return <span style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>{def.agentName ?? t('assignedAgent')}</span>;
  }
  return <span style={{ color: 'var(--coral-bright)', fontWeight: 600, opacity: 0.8 }}><Icon source="⚠" size="1em" /> {t('noAgent')}</span>;
}

/** A workflow (definition) as a card — mirrors the project card layout. */
function WorkflowDefCard({
  def, onOpen, onRun, onViewRuns, onDelete, running,
}: {
  def: WorkflowDefinitionSummary;
  onOpen: (d: WorkflowDefinitionSummary) => void;
  onRun: (d: WorkflowDefinitionSummary) => void;
  onViewRuns: (d: WorkflowDefinitionSummary) => void;
  onDelete: (d: WorkflowDefinitionSummary) => void;
  running: boolean;
}) {
  const fmt = useFormat();
  const t = useTranslations('workflowsContent');
  const tc = useTranslations('common');
  return (
    <div style={{ padding: 20, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 18 }} aria-hidden><Icon source="🔀" size="1em" /></span>
        <button type="button" onClick={() => onOpen(def)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <h3 style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', margin: 0 }}>{def.name}</h3>
          {def.description && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {def.description}
            </p>
          )}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <ScopeChip def={def} />
      </div>

      <div style={{ fontSize: 12 }}>
        <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>{t('agentColon')}</span>
        <AgentLabel def={def} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto' }}>
        <RunStats def={def} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('updated', { date: fmt.date(def.updatedAt) })}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onOpen(def)} style={subtleBtn}>{t('open')}</button>
        {/* Starting a workflow puts an agent to work, so it carries the same
            DEVELOPER+ dispatch gate as a task run. Open / view-runs stay reads. */}
        <RoleGate capability="runtime.execute">
          <button type="button" onClick={() => onRun(def)} disabled={running} style={{ ...subtleBtn, opacity: running ? 0.6 : 1 }}>
            {running ? t('running') : `${t('run')}`}
          </button>
        </RoleGate>
        {(def.runCount ?? 0) > 0 && (
          <button type="button" onClick={() => onViewRuns(def)} style={subtleBtn}>{t('runsCount', { count: def.runCount ?? 0 })}</button>
        )}
        <button type="button" onClick={() => onDelete(def)} style={{ ...subtleBtn, marginLeft: 'auto' }}>{tc('delete')}</button>
      </div>
    </div>
  );
}

export function WorkflowsContent({ projectId }: WorkflowsContentProps) {
  const fmt = useFormat();
  const router = useRouter();
  const confirm = useConfirm();
  const tc = useTranslations('common');
  const t = useTranslations('workflowsContent');
  const [defs, setDefs] = useState<WorkflowDefinitionSummary[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Per-workflow run history + detail drill-down — delegated entirely to
  // WorkflowRunHistoryPanel; this only needs to know WHICH definition (and,
  // for a run just started, which run to jump straight into).
  const [runsForDef, setRunsForDef] = useState<WorkflowDefinitionSummary | null>(null);
  const [initialRunId, setInitialRunId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    workflowDefinitions
      .list()
      .then(setDefs)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchProjects().then(setProjectList).catch(() => {}); }, []);
  // Refetch when the Brain creates/updates/removes a workflow definition so this
  // list reflects the change live instead of going stale until a manual reload.
  useBrainDataRefresh(['workflows'], load);

  const visibleDefs = projectId != null ? defs.filter((d) => d.projectId === projectId) : defs;

  const filteredProjectName = projectId != null
    ? projectList.find((p) => p.id === projectId)?.name
        ?? defs.find((d) => d.projectId === projectId)?.projectName
        ?? `#${projectId}`
    : null;

  const openDef = (d: WorkflowDefinitionSummary) => router.push(`/workflows/builder?id=${d.id}`);
  const newWorkflow = () => router.push(projectId != null ? `/workflows/builder?project=${projectId}` : '/workflows/builder');

  const viewRuns = useCallback((d: WorkflowDefinitionSummary) => {
    setInitialRunId(null);
    setRunsForDef(d);
  }, []);

  const runDef = async (d: WorkflowDefinitionSummary) => {
    if (!hasAgent(d)) {
      setNotice(t('noticeNoAgent', { name: d.name }));
      return;
    }
    setRunningId(d.id);
    setNotice(null);
    try {
      const result = await workflowDefinitions.run(d.id, savedRunTarget(d));
      // A definition whose `approvalMode` is `required` answers 202 with a pending
      // approval INSTEAD of a run (migration 1092). Reporting "started a run" there
      // would be the exact failure the gate exists to prevent — the UI claiming work
      // began that a human has not yet allowed.
      if (result.status === 'pending') {
        setNotice(t('noticeRunPendingApproval', { name: d.name }));
        return;
      }
      setNotice(t('noticeRunStarted', { name: d.name }));
      load(); // refresh run counts
      setInitialRunId(result.workflowId);
      setRunsForDef(d);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t('failedStartRun'));
    } finally {
      setRunningId(null);
    }
  };

  const deleteDef = async (d: WorkflowDefinitionSummary) => {
    if (!(await confirm(tc('deleteWorkflowConfirm', { name: d.name })))) return;
    try {
      await workflowDefinitions.remove(d.id);
      setDefs((prev) => prev.filter((x) => x.id !== d.id));
    } catch {
      setNotice(t('failedDelete'));
    }
  };

  // ---- Per-workflow run history + detail view ------------------------------
  if (runsForDef) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => { setRunsForDef(null); setInitialRunId(null); }}
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            ← {t('back')}
          </button>
          <div style={{ flex: 1 }} />
          <RoleGate capability="runtime.execute">
            <button type="button" onClick={() => runDef(runsForDef)} disabled={runningId === runsForDef.id} style={{ ...subtleBtn, opacity: runningId === runsForDef.id ? 0.6 : 1 }}>
              {runningId === runsForDef.id ? t('running') : `${t('runNow')}`}
            </button>
          </RoleGate>
        </div>
        <WorkflowRunHistoryPanel definitionId={runsForDef.id} definitionName={runsForDef.name} initialRunId={initialRunId} />
      </div>
    );
  }

  // ---- List view ----------------------------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{t('title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
            {t('subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <button type="button" onClick={newWorkflow} style={primaryBtn}>+ {t('newWorkflow')}</button>
        </div>
      </div>

      {/* Active project filter banner */}
      {projectId != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'var(--surface-coral-soft, rgba(244,114,94,0.12))', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', fontSize: 13 }}>
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('filteredToProject')} <strong style={{ color: 'var(--text-primary)' }}>{filteredProjectName}</strong>
          </span>
          <button
            type="button"
            onClick={() => router.push('/workflows')}
            style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {t('clearFilter')}
          </button>
        </div>
      )}

      {notice && (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }} aria-label={tc('dismiss')}>×</button>
        </div>
      )}

      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loadingWorkflows')}</div>}
      {error && <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>{t('error', { message: error })}</div>}

      {!loading && visibleDefs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}><Icon source="🔀" size="1em" /></div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            {projectId != null ? t('emptyForProject') : t('empty')}
          </p>
          <button type="button" onClick={newWorkflow} style={{ ...primaryBtn, padding: '12px 24px' }}>{t('newWorkflow')}</button>
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleDefs.map((d) => (
            <WorkflowDefCard key={d.id} def={d} onOpen={openDef} onRun={runDef} onViewRuns={viewRuns} onDelete={deleteDef} running={runningId === d.id} />
          ))}
        </div>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                {[t('colName'), t('colProject'), t('colAgent'), t('colRuns'), t('colUpdated'), t('colActions')].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleDefs.map((d) => (
                <tr key={d.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    <button type="button" onClick={() => openDef(d)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                      {d.name}
                    </button>
                  </td>
                  <td style={{ padding: '12px 16px' }}><ScopeChip def={d} /></td>
                  <td style={{ padding: '12px 16px' }}><AgentLabel def={d} /></td>
                  <td style={{ padding: '12px 16px' }}>
                    {(d.runCount ?? 0) > 0 ? (
                      <button type="button" onClick={() => viewRuns(d)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                        <RunStats def={d} />
                      </button>
                    ) : (
                      <RunStats def={d} />
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{fmt.date(d.updatedAt)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => openDef(d)} style={subtleBtn}>{t('open')}</button>
                      <RoleGate capability="runtime.execute">
                        <button type="button" onClick={() => runDef(d)} disabled={runningId === d.id} style={{ ...subtleBtn, opacity: runningId === d.id ? 0.6 : 1 }}>
                          {runningId === d.id ? t('running') : `${t('run')}`}
                        </button>
                      </RoleGate>
                      <button type="button" onClick={() => deleteDef(d)} style={subtleBtn}>{tc('delete')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
