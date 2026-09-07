'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { Select } from '@/components/Select';
import { Button, Icon, TextField } from '@/components/ui';
import { creationSessionFoldersApi, type CreationSessionFolder } from '@/lib/builderforceApi';
import type { Project } from '@/lib/types';
import styles from './CreationFolderBar.module.css';

/** null = every folder, `UNFILED` = sessions in none, otherwise a folder id. */
export type FolderSelection = string | null;
export const UNFILED = '';

const NO_PROJECT = '';

interface Props {
  folders: CreationSessionFolder[];
  /** Projects a folder can be tied to; the picker is hidden when there are none. */
  projects: Project[];
  /** Sessions currently in no folder — the count beside "Unfiled". */
  unfiledCount: number;
  totalCount: number;
  selected: FolderSelection;
  onSelect: (selection: FolderSelection) => void;
  /** Folders changed on the server — the library re-reads. */
  onChanged: () => void;
}

/**
 * The ONE folder control: it filters the library and it manages the folders.
 *
 * Both used to exist, in two places that did not know about each other — the
 * headings here, which only labelled a group, and a separate "Sessions &
 * folders" slide-out reached from a caret in the sidebar, which is where
 * renaming, deleting and tying a folder to a Project lived. A reader who found
 * one never learned the other existed.
 */
export function CreationFolderBar({ folders, projects, unfiledCount, totalCount, selected, onSelect, onChanged }: Props) {
  const t = useTranslations('creationFolders');
  const confirm = useConfirm();
  const [editing, setEditing] = useState<CreationSessionFolder | null>(null);
  const [name, setName] = useState('');
  const [creatingName, setCreatingName] = useState('');
  const [busy, setBusy] = useState(false);

  const startRename = (folder: CreationSessionFolder) => { setEditing(folder); setName(folder.name); };
  const submitRename = async () => {
    const next = name.trim();
    const folder = editing;
    setEditing(null);
    if (!folder || !next || next === folder.name) return;
    await creationSessionFoldersApi.update(folder.id, { name: next });
    onChanged();
  };
  const setFolderProject = async (folder: CreationSessionFolder, projectId: string) => {
    await creationSessionFoldersApi.update(folder.id, { projectId: projectId ? Number(projectId) : null });
    onChanged();
  };
  const removeFolder = async (folder: CreationSessionFolder) => {
    const approved = await confirm({
      title: t('deleteTitle'),
      message: t('deleteMessage', { name: folder.name, count: folder.sessionCount }),
      confirmLabel: t('delete'),
      destructive: true,
    });
    if (!approved) return;
    if (selected === folder.id) onSelect(null);
    await creationSessionFoldersApi.remove(folder.id);
    onChanged();
  };
  const createFolder = async () => {
    const next = creatingName.trim();
    if (!next) return;
    setBusy(true);
    try {
      await creationSessionFoldersApi.ensure(next);
      setCreatingName('');
      onChanged();
    } finally { setBusy(false); }
  };

  return (
    <div className={styles.bar} role="group" aria-label={t('label')}>
      <button type="button" className={styles.chip} aria-pressed={selected === null} onClick={() => onSelect(null)}>
        {t('all')} <span className={styles.count}>{totalCount}</span>
      </button>
      <button type="button" className={styles.chip} aria-pressed={selected === UNFILED} onClick={() => onSelect(UNFILED)}>
        {t('unfiled')} <span className={styles.count}>{unfiledCount}</span>
      </button>

      {folders.map((folder) => (
        <span key={folder.id} className={styles.folder}>
          <button type="button" className={styles.chip} aria-pressed={selected === folder.id} onClick={() => onSelect(folder.id)}>
            <Icon name="folder" size={14} /> {folder.name} <span className={styles.count}>{folder.sessionCount}</span>
          </button>
          {/* Renaming, deleting and the Project tie sit ON the folder they act
              on, rather than in a second surface that has to be discovered. */}
          <Button type="button" variant="ghost" size="sm" className={styles.folderAction} title={t('rename')} aria-label={t('renameFolder', { name: folder.name })} onClick={() => startRename(folder)}>
            <Icon name="edit" size={14} />
          </Button>
          <Button type="button" variant="ghost" size="sm" className={styles.folderAction} title={t('delete')} aria-label={t('deleteFolder', { name: folder.name })} onClick={() => void removeFolder(folder)}>
            <Icon name="trash" size={14} />
          </Button>
          {projects.length > 0 && (
            <Select
              className={styles.projectSelect}
              value={folder.projectId != null ? String(folder.projectId) : NO_PROJECT}
              onChange={(event) => void setFolderProject(folder, event.target.value)}
              aria-label={t('folderProjectLabel', { name: folder.name })}
            >
              <option value={NO_PROJECT}>{t('noProject')}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </Select>
          )}
        </span>
      ))}

      {editing && (
        <span className={styles.inlineForm}>
          <TextField
            id="creation-folder-rename"
            autoFocus
            label={t('renameLabel')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitRename(); } if (event.key === 'Escape') setEditing(null); }}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => void submitRename()}>{t('save')}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>{t('cancel')}</Button>
        </span>
      )}

      <span className={styles.inlineForm}>
        <TextField
          id="creation-folder-new"
          label={t('newFolder')}
          value={creatingName}
          onChange={(event) => setCreatingName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createFolder(); } }}
        />
        <Button type="button" variant="secondary" size="sm" loading={busy} disabled={!creatingName.trim()} onClick={() => void createFolder()}>
          <Icon name="plus" size={14} /> {t('add')}
        </Button>
      </span>
    </div>
  );
}
