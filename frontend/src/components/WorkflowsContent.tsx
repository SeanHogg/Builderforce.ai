'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { workflows, workflowDefinitions, type Workflow, type WorkflowTask, type WorkflowGraph, type WorkflowDefinitionSummary } from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { WorkflowDagView } from './WorkflowDagView';
import { WorkflowCreatePanel } from './WorkflowCreatePanel';

/** Saved visual workflow definitions (builder templates) with quick links to
 *  open the builder. Self-contained: fetches its own data and renders nothing
 *  but the "Build new" entry when none exist yet. */
function SavedDefinitionsSection() {
  const [defs, setDefs] = useState<WorkflowDefinitionSummary[]>([]);
  useEffect(() => { workflowDefinitions.list().then(setDefs).catch(() => {}); }, []);

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: defs.length ? 10 : 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Visual workflows</div>
        <Link href="/workflows/builder" style={{ fontSize: 12, fontWeight: 600, color: 'var(--coral-bright, #f4726e)', textDecoration: 'none' }}>
          + Build new
        </Link>
      </div>
      {defs.map((d) => (
        <Link
          key={d.id}
          href={`/workflows/builder?id=${d.id}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid var(--border-subtle)', textDecoration: 'none', color: 'var(--text-primary)' }}
        >
          <span style={{ fontSize: 13 }}>🔀</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{d.name}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(d.updatedAt).toLocaleDateString()}</span>
        </Link>
      ))}
    </div>
  );
}

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

function WorkflowTaskRow({ task }: { task: WorkflowTask }) {
  const color = STATUS_COLORS[task.status] ?? 'var(--text-muted)';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '8px 0',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          marginTop: 5,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          {task.agentRole}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
            {task.description}
          </span>
        </div>
        {task.output && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              marginTop: 4,
              maxHeight: 60,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {task.output}
          </div>
        )}
        {task.error && (
          <div style={{ fontSize: 11, color: 'var(--coral-bright, #f4726e)', marginTop: 4 }}>
            {task.error}
          </div>
        )}
      </div>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          padding: '2px 7px',
          borderRadius: 5,
          background: `${color}22`,
          color,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {task.status}
      </span>
    </div>
  );
}

/** A single workflow as a card — mirrors the project card layout, surfacing the
 *  associated project + agent so the two pages read the same way. */
function WorkflowCard({ workflow, onSelect }: { workflow: Workflow; onSelect: (wf: Workflow) => void }) {
  const color = STATUS_COLORS[workflow.status] ?? 'var(--text-muted)';
  const taskCount = workflow.tasks?.length ?? 0;
  const doneCount = workflow.tasks?.filter((t) => t.status === 'completed').length ?? 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(workflow)}
      style={{
        padding: 20,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        transition: 'border-color 0.2s',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = ''; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            padding: '2px 7px',
            borderRadius: 5,
            background: `${color}22`,
            color,
          }}
        >
          {workflow.status}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 5,
            background: 'var(--surface-interactive)',
            color: 'var(--text-muted)',
          }}
        >
          {workflow.workflowType}
        </span>
      </div>

      <h3 style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', margin: 0 }}>
        {workflow.description ?? `Workflow ${workflow.id.slice(0, 8)}`}
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>Project:</span>
          <span style={{ color: workflow.projectName ? 'var(--text-secondary)' : 'var(--text-muted)', fontWeight: workflow.projectName ? 600 : 400 }}>
            {workflow.projectName ?? '—'}
          </span>
        </div>
        <div style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>Agent:</span>
          <span style={{ color: workflow.agentHostName ? 'var(--coral-bright)' : 'var(--text-muted)', fontWeight: workflow.agentHostName ? 600 : 400 }}>
            {workflow.agentHostName ?? `#${workflow.agentHostId}`}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 'auto' }}>
        {new Date(workflow.createdAt).toLocaleDateString()}
        {taskCount > 0 ? ` · ${doneCount}/${taskCount} tasks done` : ''}
      </div>
    </button>
  );
}

export function WorkflowsContent({ projectId }: WorkflowsContentProps) {
  const router = useRouter();
  const [wfList, setWfList] = useState<Workflow[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<Workflow | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<'tasks' | 'graph'>('tasks');
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    workflows
      .list({ projectId: projectId ?? undefined })
      .then(setWfList)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Projects power the create panel's dropdown + the filter banner's name.
  useEffect(() => { fetchProjects().then(setProjectList).catch(() => {}); }, []);

  const filteredProjectName = projectId != null
    ? projectList.find((p) => p.id === projectId)?.name ?? wfList.find((w) => w.projectName)?.projectName ?? `#${projectId}`
    : null;

  const openDetail = async (wf: Workflow) => {
    setSelected(wf);
    setDetailTab('tasks');
    setGraph(null);
    if (wf.tasks) { setSelectedDetail(wf); return; }
    setLoadingDetail(true);
    try {
      const detail = await workflows.get(wf.id);
      setSelectedDetail(detail);
    } catch {
      setSelectedDetail(wf);
    } finally {
      setLoadingDetail(false);
    }
  };

  const loadGraph = useCallback(async (workflowId: string) => {
    setLoadingGraph(true);
    try {
      const g = await workflows.getGraph(workflowId);
      setGraph(g);
    } catch {
      setGraph(null);
    } finally {
      setLoadingGraph(false);
    }
  }, []);

  if (selected && selectedDetail) {
    const tasks = selectedDetail.tasks ?? [];
    const tabBtnStyle = (active: boolean): React.CSSProperties => ({
      padding: '5px 14px',
      fontSize: 12,
      fontWeight: 600,
      borderRadius: 7,
      border: '1px solid var(--border-subtle)',
      background: active ? 'var(--surface-interactive)' : 'transparent',
      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
      cursor: 'pointer',
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => { setSelected(null); setSelectedDetail(null); }}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--bg-base)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              {selectedDetail.description ?? `Workflow ${selectedDetail.id.slice(0, 8)}`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              {selectedDetail.workflowType} · {selectedDetail.status}
              {selectedDetail.projectName ? ` · ${selectedDetail.projectName}` : ''}
            </div>
          </div>
          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" style={tabBtnStyle(detailTab === 'tasks')} onClick={() => setDetailTab('tasks')}>
              Tasks
            </button>
            <button
              type="button"
              style={tabBtnStyle(detailTab === 'graph')}
              onClick={() => {
                setDetailTab('graph');
                if (!graph && !loadingGraph) void loadGraph(selectedDetail.id);
              }}
            >
              Graph
            </button>
          </div>
        </div>

        <div style={cardStyle}>
          {detailTab === 'tasks' ? (
            <>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
                Tasks ({tasks.length})
              </div>
              {loadingDetail ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading tasks…</div>
              ) : tasks.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No tasks in this workflow yet.</div>
              ) : (
                tasks.map((t) => <WorkflowTaskRow key={t.id} task={t} />)
              )}
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
                Dependency Graph
              </div>
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Workflows</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
            Orchestrate multi-step agent tasks. Associate a workflow with a project and agent.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          style={{
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
          }}
        >
          + New workflow
        </button>
      </div>

      {/* Active project filter banner */}
      {projectId != null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            background: 'var(--surface-coral-soft, rgba(244,114,94,0.12))',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>
            Filtered to project <strong style={{ color: 'var(--text-primary)' }}>{filteredProjectName}</strong>
          </span>
          <button
            type="button"
            onClick={() => router.push('/workflows')}
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--coral-bright)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Clear filter
          </button>
        </div>
      )}

      <SavedDefinitionsSection />

      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading workflows…</div>}
      {error && <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>Error: {error}</div>}

      {!loading && wfList.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: 48,
            background: 'var(--bg-elevated)',
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ fontSize: 56, marginBottom: 16 }}>🔀</div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            No workflows {projectId != null ? 'for this project ' : ''}yet. Create one to orchestrate multi-step agent tasks.
          </p>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            style={{
              padding: '12px 24px',
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
            }}
          >
            New workflow
          </button>
        </div>
      )}

      {wfList.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {wfList.map((wf) => (
            <WorkflowCard key={wf.id} workflow={wf} onSelect={openDetail} />
          ))}
        </div>
      )}

      <WorkflowCreatePanel
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={load}
        projects={projectList}
        defaultProjectId={projectId}
      />
    </div>
  );
}
