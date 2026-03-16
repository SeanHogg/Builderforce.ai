'use client';

import { useState, useEffect } from 'react';
import { clawProjectsApi, type ClawProject } from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import Link from 'next/link';

interface ClawProjectsContentProps {
  clawId: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--cyan-bright, #00e5cc)',
  completed: 'var(--text-muted)',
  archived: 'var(--text-muted)',
  on_hold: 'var(--text-muted)',
};

export function ClawProjectsContent({ clawId }: ClawProjectsContentProps) {
  const [associations, setAssociations] = useState<ClawProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allProjects, setAllProjects] = useState<Array<{ id: number; name: string }>>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
  const [assigning, setAssigning] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    clawProjectsApi
      .list(clawId)
      .then(setAssociations)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    fetchProjects()
      .then((projects) => setAllProjects(projects.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => {});
  }, [clawId]);

  const handleAssign = async () => {
    if (!selectedProjectId) return;
    setAssigning(true);
    try {
      await clawProjectsApi.assign(clawId, Number(selectedProjectId));
      setShowAssign(false);
      setSelectedProjectId('');
      load();
    } catch {
      // ignore
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassign = async (projectId: number) => {
    try {
      await clawProjectsApi.unassign(clawId, projectId);
      setAssociations((prev) => prev.filter((a) => a.projectId !== projectId));
    } catch {
      // ignore
    }
  };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading projects…</div>;
  if (error) return <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>Error: {error}</div>;

  const assignedIds = new Set(associations.map((a) => a.projectId));
  const availableToAssign = allProjects.filter((p) => !assignedIds.has(p.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          Projects ({associations.length})
        </div>
        {availableToAssign.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAssign(!showAssign)}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
              background: showAssign ? 'var(--bg-base)' : 'var(--surface-interactive)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            {showAssign ? 'Cancel' : '+ Assign Project'}
          </button>
        )}
      </div>

      {showAssign && (
        <div style={{ ...cardStyle, display: 'flex', gap: 8 }}>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : '')}
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
            <option value="">Select a project…</option>
            {availableToAssign.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAssign}
            disabled={!selectedProjectId || assigning}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              background: 'var(--coral-bright, #f4726e)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: !selectedProjectId || assigning ? 'not-allowed' : 'pointer',
              opacity: !selectedProjectId || assigning ? 0.5 : 1,
            }}
          >
            {assigning ? '…' : 'Assign'}
          </button>
        </div>
      )}

      {associations.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          No projects assigned to this claw yet.
        </div>
      ) : (
        associations.map((assoc) => {
          const project = assoc.project;
          return (
            <div key={assoc.projectId} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {project?.name ?? `Project #${assoc.projectId}`}
                </div>
                {project?.description && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      marginTop: 3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {project.description}
                  </div>
                )}
                {assoc.role && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    Role: {assoc.role}
                  </div>
                )}
              </div>
              {project?.status && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '3px 8px',
                    borderRadius: 6,
                    background: 'var(--bg-elevated)',
                    color: STATUS_COLORS[project.status] ?? 'var(--text-muted)',
                    flexShrink: 0,
                  }}
                >
                  {project.status}
                </span>
              )}
              <Link
                href={`/projects/${assoc.projectId}`}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  textDecoration: 'none',
                  flexShrink: 0,
                }}
              >
                Open
              </Link>
              <button
                type="button"
                onClick={() => handleUnassign(assoc.projectId)}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'none',
                  color: 'var(--coral-bright, #f4726e)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Remove
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
