'use client';

import { useState, useEffect } from 'react';
import { agentHosts, specsApi, type AgentHost, type Spec } from '@/lib/builderforceApi';
import type { Project } from '@/lib/types';
import { AUTH_API_URL, getStoredTenantToken } from '@/lib/auth';

const WORKFLOW_TYPES = ['feature', 'bugfix', 'refactor', 'planning', 'adversarial', 'custom'];

export interface WorkflowCreatePanelProps {
  open: boolean;
  onClose: () => void;
  /** Called after a workflow is created so the list can refresh. */
  onCreated: () => void;
  /** Projects available to associate (owned by the parent so it isn't fetched twice). */
  projects: Project[];
  /** Pre-select this project (e.g. when the page is filtered to one project). */
  defaultProjectId?: number | null;
}

const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.35)' };
const drawerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 440,
  maxWidth: '100%',
  background: 'var(--bg-elevated)',
  borderLeft: '1px solid var(--border-subtle)',
  boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
};
const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: 13,
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  outline: 'none',
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 };

/**
 * Slide-out side panel to create a workflow — mirrors the project create flow.
 * Self-contained for agentHosts + specs; projects are passed in by the parent so
 * the two surfaces share one fetch.
 */
export function WorkflowCreatePanel({ open, onClose, onCreated, projects, defaultProjectId }: WorkflowCreatePanelProps) {
  const [type, setType] = useState('feature');
  const [desc, setDesc] = useState('');
  const [agentHostId, setAgentHostId] = useState<number | ''>('');
  const [projectId, setProjectId] = useState<number | ''>(defaultProjectId ?? '');
  const [specId, setSpecId] = useState('');
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [specList, setSpecList] = useState<Spec[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    agentHosts.list().then(setAgentHostList).catch(() => {});
  }, [open]);

  // Reset the project selection to the active filter each time the panel opens.
  useEffect(() => {
    if (open) setProjectId(defaultProjectId ?? '');
  }, [open, defaultProjectId]);

  // Specs are project-scoped: refetch whenever the chosen project changes.
  useEffect(() => {
    if (!open) return;
    specsApi.list(projectId === '' ? null : projectId).then(setSpecList).catch(() => setSpecList([]));
  }, [open, projectId]);

  if (!open) return null;

  const handleCreate = async () => {
    if (!agentHostId) return;
    setCreating(true);
    setError(null);
    try {
      const token = getStoredTenantToken();
      const res = await fetch(`${AUTH_API_URL}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          agentHostId: Number(agentHostId),
          projectId: projectId === '' ? null : Number(projectId),
          workflowType: type,
          description: desc.trim() || undefined,
          specId: specId || undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to create workflow');
      setDesc('');
      setSpecId('');
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workflow');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div role="presentation" style={overlayStyle} onClick={onClose} aria-hidden />
      <div style={drawerStyle} role="dialog" aria-label="New workflow">
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)' }}>New workflow</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--bg-base)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <span style={labelStyle}>Type</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {WORKFLOW_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    background: type === t ? 'var(--surface-coral-soft, rgba(244,114,94,0.15))' : 'var(--bg-deep)',
                    color: type === t ? 'var(--coral-bright, #f4726e)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="wf-desc" style={labelStyle}>Description</label>
            <input
              id="wf-desc"
              type="text"
              placeholder="What should this workflow accomplish?"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              style={fieldStyle}
            />
          </div>

          <div>
            <label htmlFor="wf-agent" style={labelStyle}>Agent *</label>
            <select
              id="wf-agent"
              value={agentHostId}
              onChange={(e) => setAgentHostId(e.target.value ? Number(e.target.value) : '')}
              style={fieldStyle}
            >
              <option value="">Select agent…</option>
              {agentHostList.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="wf-project" style={labelStyle}>Project</label>
            <select
              id="wf-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')}
              style={fieldStyle}
            >
              <option value="">No project (tenant-wide)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {specList.length > 0 && (
            <div>
              <label htmlFor="wf-spec" style={labelStyle}>Link to spec (optional)</label>
              <select
                id="wf-spec"
                value={specId}
                onChange={(e) => setSpecId(e.target.value)}
                style={fieldStyle}
              >
                <option value="">None</option>
                {specList.map((s) => (
                  <option key={s.id} value={s.id}>{s.goal.slice(0, 60)}</option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: 'var(--error-text, #e55)', padding: '8px 10px', background: 'rgba(230,80,80,0.08)', borderRadius: 6, border: '1px solid rgba(230,80,80,0.2)' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '9px 16px',
              fontSize: 13,
              background: 'var(--bg-deep)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!agentHostId || creating}
            style={{
              padding: '9px 18px',
              fontSize: 13,
              fontWeight: 600,
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: !agentHostId || creating ? 'not-allowed' : 'pointer',
              opacity: !agentHostId || creating ? 0.6 : 1,
            }}
          >
            {creating ? 'Creating…' : 'Create workflow'}
          </button>
        </div>
      </div>
    </>
  );
}
