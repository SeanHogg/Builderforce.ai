'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  workflows,
  workflowDefinitions,
  type Workflow,
  type WorkflowTask,
  type WorkflowGraph,
  type WorkflowDefinitionSummary,
  type WorkflowRunTarget,
} from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { WorkflowDagView } from './WorkflowDagView';
import { ViewToggle, type ViewMode } from './ViewToggle';

interface WorkflowsContentProps {
  projectId?: number | null;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--text-muted)',
  running: 'var(--cyan-bright, #00e5cc)',
  completed: 'rgba(34,197,94,0.9)',
  failed: 'var(--coral-bright, #f4726e)',
  cancelled: 'var(--text-muted)',
};

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 18px',
  fontSize: '0.875rem',
  fontWeight: 600,
  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  cursor: 'pointer',
  fontFamily: 'var(--font-display)',
  boxShadow: '0 4px 14px var(--shadow-coral-mid)',
};

const subtleBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--coral-bright)',
  background: 'var(--bg-base)',
  border: '1px solid var(--coral-bright)',
  borderRadius: 8,
  cursor: 'pointer',
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

/** Status pill — one source of truth for run/task status colouring. */
function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'var(--text-muted)';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5, background: `${color}22`, color, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

/** Run-history rollup line ("12 runs · last completed") — shared by card + row. */
function RunStats({ def }: { def: WorkflowDefinitionSummary }) {
  const count = def.runCount ?? 0;
  if (count === 0) return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No runs yet</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
      {count} run{count === 1 ? '' : 's'}
      {def.lastRunStatus && <>· last <StatusPill status={def.lastRunStatus} /></>}
    </span>
  );
}

function WorkflowTaskRow({ task }: { task: WorkflowTask }) {
  const color = STATUS_COLORS[task.status] ?? 'var(--text-muted)';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 5 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          {task.agentRole}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>{task.description}</span>
        </div>
        {task.output && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {task.output}
          </div>
        )}
        {task.error && <div style={{ fontSize: 11, color: 'var(--coral-bright, #f4726e)', marginTop: 4 }}>{task.error}</div>}
      </div>
      <StatusPill status={task.status} />
    </div>
  );
}

/** The project / tenant-wide scope chip — one source of truth for both views. */
function ScopeChip({ def }: { def: WorkflowDefinitionSummary }) {
  const bound = def.projectId != null;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 5,
        background: bound ? 'var(--surface-coral-soft, rgba(244,114,94,0.12))' : 'var(--surface-interactive)',
        color: bound ? 'var(--coral-bright)' : 'var(--text-muted)',
        whiteSpace: 'nowrap',
      }}
    >
      {bound ? (def.projectName ?? `Project #${def.projectId}`) : 'Tenant-wide'}
    </span>
  );
}

/** The assigned-agent label — coral when set, a warning when unassigned (every
 *  workflow needs an agent to execute). Shared by card + table. */
function AgentLabel({ def }: { def: WorkflowDefinitionSummary }) {
  if (hasAgent(def)) {
    return <span style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>{def.agentName ?? 'Assigned agent'}</span>;
  }
  return <span style={{ color: 'var(--coral-bright)', fontWeight: 600, opacity: 0.8 }}>⚠ No agent</span>;
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
  return (
    <div style={{ padding: 20, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 18 }} aria-hidden>🔀</span>
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
        <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>Agent:</span>
        <AgentLabel def={def} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto' }}>
        <RunStats def={def} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Updated {new Date(def.updatedAt).toLocaleDateString()}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onOpen(def)} style={subtleBtn}>Open</button>
        <button type="button" onClick={() => onRun(def)} disabled={running} style={{ ...subtleBtn, opacity: running ? 0.6 : 1 }}>
          {running ? 'Running…' : '▶ Run'}
        </button>
        {(def.runCount ?? 0) > 0 && (
          <button type="button" onClick={() => onViewRuns(def)} style={subtleBtn}>Runs ({def.runCount})</button>
        )}
        <button type="button" onClick={() => onDelete(def)} style={{ ...subtleBtn, marginLeft: 'auto' }}>Delete</button>
      </div>
    </div>
  );
}

export function WorkflowsContent({ projectId }: WorkflowsContentProps) {
  const router = useRouter();
  const [defs, setDefs] = useState<WorkflowDefinitionSummary[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Per-workflow run history drill-down.
  const [runsForDef, setRunsForDef] = useState<WorkflowDefinitionSummary | null>(null);
  const [defRuns, setDefRuns] = useState<Workflow[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  // Run detail (one execution) — tasks + dependency graph.
  const [selectedDetail, setSelectedDetail] = useState<Workflow | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<'tasks' | 'graph'>('tasks');
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);

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

  const visibleDefs = projectId != null ? defs.filter((d) => d.projectId === projectId) : defs;

  const filteredProjectName = projectId != null
    ? projectList.find((p) => p.id === projectId)?.name
        ?? defs.find((d) => d.projectId === projectId)?.projectName
        ?? `#${projectId}`
    : null;

  const openDef = (d: WorkflowDefinitionSummary) => router.push(`/workflows/builder?id=${d.id}`);
  const newWorkflow = () => router.push(projectId != null ? `/workflows/builder?projectId=${projectId}` : '/workflows/builder');

  const viewRuns = useCallback(async (d: WorkflowDefinitionSummary) => {
    setRunsForDef(d);
    setLoadingRuns(true);
    try {
      setDefRuns(await workflowDefinitions.runs(d.id));
    } catch {
      setDefRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const runDef = async (d: WorkflowDefinitionSummary) => {
    if (!hasAgent(d)) {
      setNotice(`"${d.name}" has no agent assigned — open it and pick a run target first.`);
      return;
    }
    setRunningId(d.id);
    setNotice(null);
    try {
      const { workflowId } = await workflowDefinitions.run(d.id, savedRunTarget(d));
      setNotice(`Started a run of "${d.name}".`);
      load(); // refresh run counts
      const detail = await workflows.get(workflowId).catch(() => null);
      if (detail) openDetail(detail);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to start run');
    } finally {
      setRunningId(null);
    }
  };

  const deleteDef = async (d: WorkflowDefinitionSummary) => {
    if (!window.confirm(`Delete workflow "${d.name}"? This cannot be undone.`)) return;
    try {
      await workflowDefinitions.remove(d.id);
      setDefs((prev) => prev.filter((x) => x.id !== d.id));
    } catch {
      setNotice('Failed to delete workflow');
    }
  };

  const openDetail = async (wf: Workflow) => {
    setSelectedDetail(wf);
    setDetailTab('tasks');
    setGraph(null);
    if (wf.tasks) return;
    setLoadingDetail(true);
    try {
      setSelectedDetail(await workflows.get(wf.id));
    } catch {
      setSelectedDetail(wf);
    } finally {
      setLoadingDetail(false);
    }
  };

  const loadGraph = useCallback(async (workflowId: string) => {
    setLoadingGraph(true);
    try {
      setGraph(await workflows.getGraph(workflowId));
    } catch {
      setGraph(null);
    } finally {
      setLoadingGraph(false);
    }
  }, []);

  // ---- Run detail view ----------------------------------------------------
  if (selectedDetail) {
    const tasks = selectedDetail.tasks ?? [];
    const tabBtnStyle = (active: boolean): React.CSSProperties => ({
      padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 7,
      border: '1px solid var(--border-subtle)',
      background: active ? 'var(--surface-interactive)' : 'transparent',
      color: active ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'pointer',
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => setSelectedDetail(null)}
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer' }}
          >
            ← Back
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              {selectedDetail.description ?? `Run ${selectedDetail.id.slice(0, 8)}`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              {selectedDetail.workflowType} · {selectedDetail.status}
              {selectedDetail.projectName ? ` · ${selectedDetail.projectName}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" style={tabBtnStyle(detailTab === 'tasks')} onClick={() => setDetailTab('tasks')}>Tasks</button>
            <button
              type="button"
              style={tabBtnStyle(detailTab === 'graph')}
              onClick={() => { setDetailTab('graph'); if (!graph && !loadingGraph) void loadGraph(selectedDetail.id); }}
            >
              Graph
            </button>
          </div>
        </div>

        <div style={cardStyle}>
          {detailTab === 'tasks' ? (
            <>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Tasks ({tasks.length})</div>
              {loadingDetail ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading tasks…</div>
              ) : tasks.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No tasks in this run yet.</div>
              ) : (
                tasks.map((t) => <WorkflowTaskRow key={t.id} task={t} />)
              )}
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Dependency Graph</div>
              {loadingGraph ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading graph…</div>
              ) : graph ? (
                <WorkflowDagView nodes={graph.nodes} edges={graph.edges} />
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No graph data available.</div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ---- Per-workflow run history view --------------------------------------
  if (runsForDef) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => { setRunsForDef(null); setDefRuns([]); }}
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer' }}
          >
            ← Back
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{runsForDef.name} · Runs</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Execution history (newest first)</div>
          </div>
          <button type="button" onClick={() => runDef(runsForDef)} disabled={runningId === runsForDef.id} style={{ ...subtleBtn, opacity: runningId === runsForDef.id ? 0.6 : 1 }}>
            {runningId === runsForDef.id ? 'Running…' : '▶ Run now'}
          </button>
        </div>

        {loadingRuns ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading runs…</div>
        ) : defRuns.length === 0 ? (
          <div style={{ ...cardStyle, fontSize: 12, color: 'var(--text-muted)' }}>No runs yet.</div>
        ) : (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
            {defRuns.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openDetail(r)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'none', cursor: 'pointer' }}
              >
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.description ?? `Run ${r.id.slice(0, 8)}`}
                </span>
                <StatusPill status={r.status} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(r.createdAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---- List view ----------------------------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Workflows</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
            Visually-authored, multi-step agent automations. Each runs under a project or tenant-wide, with an assigned agent.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <button type="button" onClick={newWorkflow} style={primaryBtn}>+ New workflow</button>
        </div>
      </div>

      {/* Active project filter banner */}
      {projectId != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'var(--surface-coral-soft, rgba(244,114,94,0.12))', border: '1px solid var(--border-subtle)', borderRadius: 10, fontSize: 13 }}>
          <span style={{ color: 'var(--text-secondary)' }}>
            Filtered to project <strong style={{ color: 'var(--text-primary)' }}>{filteredProjectName}</strong>
          </span>
          <button
            type="button"
            onClick={() => router.push('/workflows')}
            style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Clear filter
          </button>
        </div>
      )}

      {notice && (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }} aria-label="Dismiss">×</button>
        </div>
      )}

      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading workflows…</div>}
      {error && <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>Error: {error}</div>}

      {!loading && visibleDefs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🔀</div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            No workflows {projectId != null ? 'for this project ' : ''}yet. Create one to orchestrate multi-step agent tasks.
          </p>
          <button type="button" onClick={newWorkflow} style={{ ...primaryBtn, padding: '12px 24px' }}>New workflow</button>
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleDefs.map((d) => (
            <WorkflowDefCard key={d.id} def={d} onOpen={openDef} onRun={runDef} onViewRuns={viewRuns} onDelete={deleteDef} running={runningId === d.id} />
          ))}
        </div>
      ) : (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                {['Name', 'Project', 'Agent', 'Runs', 'Updated', 'Actions'].map((h) => (
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
                  <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{new Date(d.updatedAt).toLocaleDateString()}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => openDef(d)} style={subtleBtn}>Open</button>
                      <button type="button" onClick={() => runDef(d)} disabled={runningId === d.id} style={{ ...subtleBtn, opacity: runningId === d.id ? 0.6 : 1 }}>
                        {runningId === d.id ? 'Running…' : '▶ Run'}
                      </button>
                      <button type="button" onClick={() => deleteDef(d)} style={subtleBtn}>Delete</button>
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
