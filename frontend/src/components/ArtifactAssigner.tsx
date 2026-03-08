'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  artifactAssignments,
  claws,
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
  const [scope, setScope] = useState<AssignmentScope>('claw');
  const [selectedId, setSelectedId] = useState('');
  const [clawsList, setClawsList] = useState<Awaited<ReturnType<typeof claws.list>>>([]);
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [tasksList, setTasksList] = useState<Awaited<ReturnType<typeof listTasks>>>([]);
  const [assignments, setAssignments] = useState<ArtifactAssignment[]>([]);
  const [assignmentsLoaded, setAssignmentsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadEntities = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [c, p, t] = await Promise.all([
        claws.list().catch(() => []),
        fetchProjects(),
        listTasks(),
      ]);
      setClawsList(c);
      setProjectsList(p);
      setTasksList(t);
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

  useEffect(() => {
    if (!open || assignmentsLoaded || (!clawsList.length && !projectsList.length && !tasksList.length)) return;
    let cancelled = false;
    (async () => {
      try {
        const all: ArtifactAssignment[] = [];
        for (const s of ['claw', 'project', 'task'] as AssignmentScope[]) {
          const entities = s === 'claw' ? clawsList : s === 'project' ? projectsList : tasksList;
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
  }, [open, assignmentsLoaded, artifactType, artifactSlug, clawsList, projectsList, tasksList]);

  const scopeEntities = (): { id: string; label: string }[] => {
    switch (scope) {
      case 'claw':
        return clawsList.map((c) => ({ id: String(c.id), label: c.name }));
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
      case 'claw':
        return clawsList.find((c) => Number(c.id) === scopeId)?.name ?? `Claw #${scopeId}`;
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

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="btn btn-secondary btn-sm"
        style={{ padding: '4px 10px', fontSize: 12 }}
        title="Assign to claw, project, or task"
      >
        📌 Assign
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 100,
            marginTop: 4,
            background: 'var(--card-bg, var(--bg-elevated))',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
            minWidth: 320,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Assign &quot;{artifactName || artifactSlug}&quot;</span>
            <button type="button" className="btn btn-secondary btn-sm" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>

          {error && <div style={{ color: 'var(--danger, #ef4444)', fontSize: 11, marginBottom: 8 }}>{error}</div>}
          {success && <div style={{ color: 'var(--success, #22c55e)', fontSize: 11, marginBottom: 8 }}>{success}</div>}

          {loading ? (
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {(['claw', 'project', 'task'] as AssignmentScope[]).map((s) => (
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

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  className="input"
                  style={{ flex: 1, fontSize: 12, padding: '4px 8px' }}
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  <option value="">Select {scope}…</option>
                  {scopeEntities().map((e) => (
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!selectedId || saving}
                  onClick={handleAssign}
                >
                  {saving ? '…' : 'Assign'}
                </button>
              </div>

              {assignments.length > 0 && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
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
      )}
    </div>
  );
}
