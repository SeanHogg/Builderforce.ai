'use client';

import { Select } from '@/components/Select';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { agentHostProjectsApi, type AgentHostProject } from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import Link from 'next/link';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { statusColor, type StatusToneMap } from '@/lib/statusTone';

interface AgentHostProjectsContentProps {
  agentHostId: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

const STATUS_TONE: StatusToneMap = {
  active: 'info',
  completed: 'neutral',
  archived: 'neutral',
  on_hold: 'neutral',
};

export function AgentHostProjectsContent({ agentHostId }: AgentHostProjectsContentProps) {
  const t = useTranslations('agentHostTabs');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [associations, setAssociations] = useState<AgentHostProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A failed assign/unassign keeps the list on screen and says why beside it.
  const [actionError, setActionError] = useState<string | null>(null);
  const [allProjects, setAllProjects] = useState<Array<{ id: number; name: string }>>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    agentHostProjectsApi
      .list(agentHostId)
      .then(setAssociations)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [agentHostId, errorMessage]);

  useEffect(() => {
    load();
    fetchProjects()
      .then((projects) => setAllProjects(projects.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => {});
  }, [load]);

  const handleAssign = async () => {
    if (!selectedProjectId) return;
    setAssigning(true);
    setActionError(null);
    try {
      await agentHostProjectsApi.assign(agentHostId, Number(selectedProjectId));
      setShowAssign(false);
      setSelectedProjectId('');
      load();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassign = async (projectId: number) => {
    setActionError(null);
    try {
      await agentHostProjectsApi.unassign(agentHostId, projectId);
      setAssociations((prev) => prev.filter((a) => a.projectId !== projectId));
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('projects.loading')}</div>;
  if (error) return <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>{t('errorPrefix', { message: error })}</div>;

  const assignedIds = new Set(associations.map((a) => a.projectId));
  const availableToAssign = allProjects.filter((p) => !assignedIds.has(p.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('projects.heading', { count: associations.length })}
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
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            {showAssign ? tc('cancel') : t('projects.assign')}
          </button>
        )}
      </div>

      {actionError && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--coral-bright)' }}>{actionError}</div>
      )}

      {showAssign && (
        <div style={{ ...cardStyle, display: 'flex', gap: 8 }}>
          <Select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : '')}
            style={{
              flex: 1,
              padding: '8px 10px',
              fontSize: 13,
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <option value="">{t('projects.selectProject')}</option>
            {availableToAssign.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <button
            type="button"
            onClick={handleAssign}
            disabled={!selectedProjectId || assigning}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              background: 'var(--coral-bright)',
              color: 'var(--text-on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: !selectedProjectId || assigning ? 'not-allowed' : 'pointer',
              opacity: !selectedProjectId || assigning ? 0.5 : 1,
            }}
          >
            {assigning ? '…' : t('projects.assignAction')}
          </button>
        </div>
      )}

      {associations.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          {t('projects.empty')}
        </div>
      ) : (
        associations.map((assoc) => {
          const project = assoc.project;
          return (
            <div key={assoc.projectId} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {project?.name ?? t('projects.projectFallback', { id: assoc.projectId })}
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
                    {t('projects.role', { role: assoc.role })}
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
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                    color: statusColor(STATUS_TONE, project.status),
                    flexShrink: 0,
                  }}
                >
                  {t('projects.status', { status: project.status })}
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
                  borderRadius: 'var(--radius-sm)',
                  textDecoration: 'none',
                  flexShrink: 0,
                }}
              >
                {t('projects.open')}
              </Link>
              <button
                type="button"
                onClick={() => handleUnassign(assoc.projectId)}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'none',
                  color: 'var(--coral-bright)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {t('projects.remove')}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
