'use client';

import { useState, useEffect, useCallback } from 'react';
import { workflows, specsApi, claws, type Workflow, type WorkflowTask, type Spec, type Claw } from '@/lib/builderforceApi';

interface WorkflowsContentProps {
  projectId?: number | null;
  compact?: boolean;
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

const WORKFLOW_TYPES = ['feature', 'bugfix', 'refactor', 'planning', 'adversarial', 'custom'];

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

function WorkflowCard({
  workflow,
  onSelect,
}: {
  workflow: Workflow;
  onSelect: (wf: Workflow) => void;
}) {
  const color = STATUS_COLORS[workflow.status] ?? 'var(--text-muted)';
  const taskCount = workflow.tasks?.length ?? 0;
  const doneCount = workflow.tasks?.filter((t) => t.status === 'completed').length ?? 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(workflow)}
      style={{
        ...cardStyle,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
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
              background: 'var(--bg-elevated)',
              color: 'var(--text-muted)',
            }}
          >
            {workflow.workflowType}
          </span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
          {workflow.description ?? `Workflow ${workflow.id.slice(0, 8)}`}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {new Date(workflow.createdAt).toLocaleString()}
          {taskCount > 0 ? ` · ${doneCount}/${taskCount} tasks done` : ''}
        </div>
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>→</span>
    </button>
  );
}

export function WorkflowsContent({ projectId, compact }: WorkflowsContentProps) {
  const [wfList, setWfList] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<Workflow | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Create workflow form
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<string>('feature');
  const [createDesc, setCreateDesc] = useState('');
  const [createClawId, setCreateClawId] = useState<number | ''>('');
  const [createSpecId, setCreateSpecId] = useState<string>('');
  const [clawList, setClawList] = useState<Claw[]>([]);
  const [specList, setSpecList] = useState<Spec[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    workflows
      .list()
      .then(setWfList)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!showCreate) return;
    claws.list().then(setClawList).catch(() => {});
    specsApi.list(projectId ?? undefined).then(setSpecList).catch(() => {});
  }, [showCreate, projectId]);

  const openDetail = async (wf: Workflow) => {
    setSelected(wf);
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

  const handleCreate = async () => {
    if (!createClawId) return;
    setCreating(true);
    try {
      // POST /api/workflows
      const token = (await import('@/lib/auth')).getStoredTenantToken();
      const { AUTH_API_URL } = await import('@/lib/auth');
      const res = await fetch(`${AUTH_API_URL}/api/workflows`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          clawId: Number(createClawId),
          workflowType: createType,
          description: createDesc.trim() || undefined,
          specId: createSpecId || undefined,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setCreateDesc('');
        setCreateSpecId('');
        load();
      }
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  };

  if (selected && selectedDetail) {
    const tasks = selectedDetail.tasks ?? [];
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
            </div>
          </div>
        </div>

        <div style={cardStyle}>
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
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {!compact && (
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Workflows ({wfList.length})
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            background: showCreate ? 'var(--bg-base)' : 'var(--surface-interactive)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            cursor: 'pointer',
            marginLeft: 'auto',
          }}
        >
          {showCreate ? 'Cancel' : '+ New Workflow'}
        </button>
      </div>

      {showCreate && (
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Create Workflow</div>

          {/* Type */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {WORKFLOW_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setCreateType(t)}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: createType === t ? 'var(--surface-coral-soft, rgba(244,114,94,0.15))' : 'var(--bg-elevated)',
                  color: createType === t ? 'var(--coral-bright, #f4726e)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Description (optional)"
            value={createDesc}
            onChange={(e) => setCreateDesc(e.target.value)}
            style={{
              padding: '8px 12px',
              fontSize: 13,
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
            }}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={createClawId}
              onChange={(e) => setCreateClawId(e.target.value ? Number(e.target.value) : '')}
              style={{
                flex: 1,
                padding: '8px 10px',
                fontSize: 13,
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
              }}
            >
              <option value="">Select claw…</option>
              {clawList.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {specList.length > 0 && (
              <select
                value={createSpecId}
                onChange={(e) => setCreateSpecId(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: 13,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                }}
              >
                <option value="">Link to spec (optional)</option>
                {specList.map((s) => (
                  <option key={s.id} value={s.id}>{s.goal.slice(0, 60)}</option>
                ))}
              </select>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!createClawId || creating}
              style={{
                padding: '8px 18px',
                fontSize: 13,
                fontWeight: 600,
                background: 'var(--coral-bright, #f4726e)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: !createClawId || creating ? 'not-allowed' : 'pointer',
                opacity: !createClawId || creating ? 0.5 : 1,
              }}
            >
              {creating ? 'Creating…' : 'Create Workflow'}
            </button>
          </div>
        </div>
      )}

      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading workflows…</div>}
      {error && <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>Error: {error}</div>}

      {!loading && wfList.length === 0 && (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          No workflows yet. Create one to orchestrate multi-step agent tasks.
        </div>
      )}

      {wfList.map((wf) => (
        <WorkflowCard key={wf.id} workflow={wf} onSelect={openDetail} />
      ))}
    </div>
  );
}
