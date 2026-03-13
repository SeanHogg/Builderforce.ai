'use client';

import { useState, useEffect } from 'react';
import { fetchProject, updateProject } from '@/lib/api';

export interface GovernanceContentProps {
  projectId: number;
  className?: string;
  style?: React.CSSProperties;
}

export function GovernanceContent({ projectId, className, style }: GovernanceContentProps) {
  const [governance, setGovernance] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const project = await fetchProject(projectId);
        if (!cancelled) {
          setGovernance(project?.governance ?? '');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load governance');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const startEdit = () => {
    setDraft(governance);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProject(projectId, { governance: draft });
      setGovernance(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save governance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 12, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Governance Rules</div>
        {!editing && !loading && (
          <button
            type="button"
            onClick={startEdit}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--surface-interactive)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Edit
          </button>
        )}
      </div>

      {error && <div style={{ padding: '8px 12px', fontSize: 12, background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: 8 }}>{error}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Define governance rules (markdown)…"
            autoFocus
            style={{
              minHeight: 200,
              padding: '10px 12px',
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.6,
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--bg-deep)',
              color: 'var(--text-primary)',
              resize: 'vertical',
              whiteSpace: 'pre-wrap',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                background: 'var(--coral-bright)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: saving ? 'wait' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                background: 'var(--surface-interactive)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : !governance.trim() ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>
          No governance rules defined for this project. Click &quot;Edit&quot; to add rules.
        </div>
      ) : (
        <div
          style={{
            padding: '12px 14px',
            background: 'var(--bg-base)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {governance}
        </div>
      )}
    </div>
  );
}
