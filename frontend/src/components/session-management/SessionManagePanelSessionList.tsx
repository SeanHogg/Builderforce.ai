'use client';

import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { Icon } from '@/components/ui';
import { creationSessionsApi, type CreationSessionFolder, type CreationSessionSummary } from '@/lib/builderforceApi';
import type { Project } from '@/lib/types';

const UNFILED = '';

export function SessionManagePanelSessionList({
  sessions,
  folders,
  projects,
  loading,
  onChanged,
}: {
  sessions: CreationSessionSummary[];
  folders: CreationSessionFolder[];
  projects: Project[];
  loading: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('sessionManagePanel');
  const tc = useTranslations('common');

  const setFolder = async (session: CreationSessionSummary, folderId: string) => {
    await creationSessionsApi.update(session.id, { folderId: folderId || null });
    onChanged();
  };
  const addProject = async (session: CreationSessionSummary, projectId: string) => {
    if (!projectId) return;
    await creationSessionsApi.linkProject(session.id, Number(projectId));
    onChanged();
  };
  const removeProject = async (session: CreationSessionSummary, projectId: number) => {
    await creationSessionsApi.unlinkProject(session.id, projectId);
    onChanged();
  };

  if (loading) return <p style={{ color: 'var(--text-secondary)' }}>{t('loading')}</p>;
  if (sessions.length === 0) return <p style={{ color: 'var(--text-secondary)' }}>{t('emptySessions')}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sessions.map((session) => {
        const tiedProjects = (session.projectIds ?? []).flatMap((id) => {
          const project = projects.find((candidate) => candidate.id === id);
          return project ? [project] : [];
        });
        const availableProjects = projects.filter((project) => !tiedProjects.some((tied) => tied.id === project.id));
        return (
          <div key={session.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-raised)' }}>
            <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                <Icon name="folder" size={14} />
                <Select
                  value={session.folderId ?? UNFILED}
                  onChange={(event) => void setFolder(session, event.target.value)}
                  aria-label={t('sessionFolderLabel', { title: session.title })}
                  style={{ fontSize: 12 }}
                >
                  <option value={UNFILED}>{tc('unfiled')}</option>
                  {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </Select>
              </label>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {tiedProjects.map((project) => (
                <span key={project.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 'var(--radius-lg)', padding: '2px 4px 2px 8px', background: 'var(--surface-sunken)', fontSize: 12 }}>
                  {project.name}
                  <button type="button" aria-label={t('untieProject', { project: project.name })} onClick={() => void removeProject(session, project.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 2 }}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
              {availableProjects.length > 0 && (
                <Select value="" onChange={(event) => void addProject(session, event.target.value)} aria-label={t('tieToProjectLabel', { title: session.title })} style={{ fontSize: 12 }}>
                  <option value="">{t('tieToProject')}</option>
                  {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </Select>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
