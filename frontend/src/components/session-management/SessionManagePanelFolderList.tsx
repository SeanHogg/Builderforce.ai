'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { Select } from '@/components/Select';
import { Icon, TextField } from '@/components/ui';
import { menuItemStyle } from '@/components/workspace/MenuSurface';
import { creationSessionFoldersApi, type CreationSessionFolder, type CreationSessionSummary } from '@/lib/builderforceApi';
import type { Project } from '@/lib/types';

/** null = "All sessions", '' (UNFILED) = sessions with no folder, else a folder id. */
export type FolderSelection = string | null;
export const UNFILED = '';

const NO_PROJECT = '';

export function SessionManagePanelFolderList({
  folders,
  projects,
  sessions,
  selected,
  onSelect,
  onChanged,
}: {
  folders: CreationSessionFolder[];
  projects: Project[];
  sessions: CreationSessionSummary[];
  selected: FolderSelection;
  onSelect: (selection: FolderSelection) => void;
  onChanged: () => void;
}) {
  const t = useTranslations('sessionManagePanel');
  const tc = useTranslations('common');
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [busy, setBusy] = useState(false);

  const unfiledCount = sessions.filter((session) => !session.folderId).length;

  const startRename = (folder: CreationSessionFolder) => {
    setEditingId(folder.id);
    setEditValue(folder.name);
  };
  const submitRename = async (folder: CreationSessionFolder) => {
    const name = editValue.trim();
    setEditingId(null);
    if (!name || name === folder.name) return;
    await creationSessionFoldersApi.update(folder.id, { name });
    onChanged();
  };
  const setFolderProject = async (folder: CreationSessionFolder, projectId: string) => {
    await creationSessionFoldersApi.update(folder.id, { projectId: projectId ? Number(projectId) : null });
    onChanged();
  };
  const removeFolder = async (folder: CreationSessionFolder) => {
    const approved = await confirm({
      title: t('deleteFolderTitle'),
      message: t('deleteFolderMessage', { name: folder.name }),
      confirmLabel: t('deleteFolder'),
      destructive: true,
    });
    if (!approved) return;
    if (selected === folder.id) onSelect(null);
    await creationSessionFoldersApi.remove(folder.id);
    onChanged();
  };
  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await creationSessionFoldersApi.ensure(name);
      setNewFolderName('');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 240 }}>
      <button type="button" style={menuItemStyle(selected == null)} onClick={() => onSelect(null)}>
        {t('allSessions')} <span style={{ color: 'var(--text-muted)' }}>({sessions.length})</span>
      </button>
      <button type="button" style={menuItemStyle(selected === UNFILED)} onClick={() => onSelect(UNFILED)}>
        {tc('unfiled')} <span style={{ color: 'var(--text-muted)' }}>({unfiledCount})</span>
      </button>

      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '6px 0' }} aria-hidden="true" />

      {folders.map((folder) => (
        <div key={folder.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '2px 0' }}>
          {editingId === folder.id ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '0 10px' }}>
              <input
                autoFocus
                className="ui-input"
                value={editValue}
                onChange={(event) => setEditValue(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void submitRename(folder); if (event.key === 'Escape') setEditingId(null); }}
                style={{ flex: 1, minWidth: 0 }}
                aria-label={t('renameFolderLabel')}
              />
              <button type="button" aria-label={t('save')} onClick={() => void submitRename(folder)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><Icon name="check" size={16} /></button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button type="button" style={{ ...menuItemStyle(selected === folder.id), flex: 1, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => onSelect(folder.id)}>
                <Icon name="folder" size={14} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.name}</span>
                <span style={{ color: 'var(--text-muted)' }}>({folder.sessionCount})</span>
              </button>
              <button type="button" aria-label={t('renameFolder')} onClick={() => startRename(folder)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><Icon name="edit" size={14} /></button>
              <button type="button" aria-label={t('deleteFolder')} onClick={() => void removeFolder(folder)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><Icon name="trash" size={14} /></button>
            </div>
          )}
          <div style={{ padding: '0 10px' }}>
            <Select
              value={folder.projectId != null ? String(folder.projectId) : NO_PROJECT}
              onChange={(event) => void setFolderProject(folder, event.target.value)}
              aria-label={t('folderProjectLabel', { name: folder.name })}
              style={{ width: '100%', fontSize: 12 }}
            >
              <option value={NO_PROJECT}>{t('noProject')}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </Select>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 4, padding: '6px 10px 0', alignItems: 'flex-end' }}>
        <TextField
          id="new-session-folder"
          label={t('newFolder')}
          value={newFolderName}
          onChange={(event) => setNewFolderName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createFolder(); } }}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="button" aria-label={t('newFolder')} disabled={busy || !newFolderName.trim()} onClick={() => void createFolder()} style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', cursor: 'pointer', padding: '8px', color: 'var(--text-primary)' }}>
          <Icon name="plus" size={16} />
        </button>
      </div>
    </div>
  );
}
