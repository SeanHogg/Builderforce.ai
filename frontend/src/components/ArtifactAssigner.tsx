'use client';

import { Select } from '@/components/Select';

import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  artifactAssignments,
  agentHosts,
  listTasks,
  type ArtifactType,
  type AssignmentScope,
  type ArtifactAssignment,
} from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';

interface ArtifactAssignerProps {
  artifactType: ArtifactType;
  artifactSlug: string;
  artifactName: string;
}

export default function ArtifactAssigner({ artifactType, artifactSlug, artifactName }: ArtifactAssignerProps) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<AssignmentScope>('host');
  const [selectedId, setSelectedId] = useState('');
  const [agentHostsList, setAgentHostsList] = useState<Awaited<ReturnType<typeof agentHosts.list>>>([]);
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [tasksList, setTasksList] = useState<Awaited<ReturnType<typeof listTasks>>>([]);
  const [assignments, setAssignments] = useState<ArtifactAssignment[]>([]);
  const [assignmentsLoaded, setAssignmentsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  // Auto-pick the first non-empty scope only once per open, so the user's
  // manual tab choice is never overridden (e.g. after an assign re-fetches).
  const didInitScope = useRef(false);

  const loadEntities = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [c, p, t] = await Promise.all([
        agentHosts.list().catch(() => []),
        fetchProjects(),
        listTasks(),
      ]);
      setAgentHostsList(c);
      setProjectsList(p);
      setTasksList(t);
      // The default scope is 'host', but most tenants have no agentHosts
      // registered yet — landing on an empty dropdown reads as broken. Fall
      // through to the first scope that actually has options.
      if (!didInitScope.current) {
        didInitScope.current = true;
        if (!c.length) setScope(p.length ? 'project' : t.length ? 'task' : 'host');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !assignmentsLoaded) {
      loadEntities();
    }
  }, [open, assignmentsLoaded, loadEntities]);

  // Re-arm scope auto-pick for the next open, and clear transient messages.
  useEffect(() => {
    if (!open) {
      didInitScope.current = false;
      setError('');
      setSuccess('');
      return;
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open || assignmentsLoaded || (!agentHostsList.length && !projectsList.length && !tasksList.length)) return;
    let cancelled = false;
    (async () => {
      try {
        const all: ArtifactAssignment[] = [];
        for (const s of ['host', 'project', 'task'] as AssignmentScope[]) {
          const entities = s === 'host' ? agentHostsList : s === 'project' ? projectsList : tasksList;
          for (const entity of entities) {
            const id = Number((entity as { id: string | number }).id);
            try {
              const list = await artifactAssignments.list(s, id, artifactType);
              if (!cancelled) all.push(...list.filter((a) => a.artifactSlug === artifactSlug));
            } catch {
              // ignore
            }
          }
        }
        if (!cancelled) {
          setAssignments(all);
          setAssignmentsLoaded(true);
        }
      } catch {
        if (!cancelled) setAssignmentsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, assignmentsLoaded, artifactType, artifactSlug, agentHostsList, projectsList, tasksList]);

  const scopeEntities = (): { id: string; label: string }[] => {
    switch (scope) {
      case 'host':
        return agentHostsList.map((c) => ({ id: String(c.id), label: c.name }));
      case 'project':
        return projectsList.map((p) => ({ id: String(p.id), label: p.name }));
      case 'task':
        return tasksList.map((t) => ({ id: String(t.id), label: `${t.key ?? ''}: ${t.title}`.trim() }));
      default:
        return [];
    }
  };

  const handleAssign = async () => {
    if (!selectedId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await artifactAssignments.assign(artifactType, artifactSlug, scope, Number(selectedId));
      setSuccess(`Assigned to ${scope}`);
      setSelectedId('');
      setAssignmentsLoaded(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assign failed');
    } finally {
      setSaving(false);
    }
  };

  const handleUnassign = async (s: AssignmentScope, scopeId: number) => {
    try {
      await artifactAssignments.unassign(artifactType, artifactSlug, s, scopeId);
      setAssignments((prev) => prev.filter((a) => !(a.scope === s && a.scopeId === scopeId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unassign failed');
    }
  };

  const scopeLabel = (s: AssignmentScope, scopeId: number): string => {
    switch (s) {
      case 'host':
        return agentHostsList.find((c) => Number(c.id) === scopeId)?.name ?? `AgentHost #${scopeId}`;
      case 'project':
        return projectsList.find((p) => Number(p.id) === scopeId)?.name ?? `Project #${scopeId}`;
      case 'task': {
        const t = tasksList.find((x) => Number(x.id) === scopeId);
        return t ? `${t.key ?? ''}: ${t.title}`.trim() : `Task #${scopeId}`;
      }
      default:
        return `${s} #${scopeId}`;
    }
  };

  const entities = scopeEntities();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-sm"
        style={{ padding: '4px 10px', fontSize: 12 }}
        title="Assign to agentHost, project, or task"
      >
        📌 Assign
      </button>

      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Assign ${artifactName || artifactSlug}`}
          className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            style={{
              maxWidth: 440,
              width: '90%',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-strong)' }}>
              <span>Assign &quot;{artifactName || artifactSlug}&quot;</span>
              <button type="button" className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: 13 }} onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>

            {error && <div style={{ color: 'var(--error-text, #ef4444)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
            {success && <div style={{ color: 'var(--success-text, #22c55e)', fontSize: 12, marginBottom: 8 }}>{success}</div>}

            {loading ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  {(['host', 'project', 'task'] as AssignmentScope[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`btn btn-sm ${scope === s ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => { setScope(s); setSelectedId(''); }}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>

                {entities.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>
                    No {scope === 'host' ? 'agentHosts' : `${scope}s`} available to assign to yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Select
                      className="input"
                      style={{ flex: 1, fontSize: 13, padding: '6px 8px' }}
                      value={selectedId}
                      onChange={(e) => setSelectedId(e.target.value)}
                    >
                      <option value="">Select {scope}…</option>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>{e.label}</option>
                      ))}
                    </Select>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!selectedId || saving}
                      onClick={handleAssign}
                    >
                      {saving ? '…' : 'Assign'}
                    </button>
                  </div>
                )}

                {assignments.length > 0 && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Current assignments</div>
                    {assignments.map((a) => (
                      <div key={`${a.scope}-${a.scopeId}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: 12 }}>
                        <span>
                          <span className="badge badge-gray" style={{ fontSize: 10 }}>{a.scope}</span>{' '}
                          {scopeLabel(a.scope, a.scopeId)}
                        </span>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          style={{ padding: '1px 6px', fontSize: 10 }}
                          onClick={() => handleUnassign(a.scope, a.scopeId)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
