'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { Select } from '@/components/Select';
import { TextField, type IconName } from '@/components/ui';
import { faultText } from '@/lib/apiClient';
import type { Project } from '@/lib/types';
import { FolderField } from './FolderField';
import { SessionEditorPanel } from './SessionEditorPanel';
import { SessionProjectField } from './SessionProjectField';
import styles from './SessionEditorPanel.module.css';

export interface ManagedSession {
  id: string;
  title: string;
  folder?: string | null;
}

export interface SessionMenuAction {
  id: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

export interface SessionManagementPorts {
  session: ManagedSession;
  mergeCandidates?: ManagedSession[];
  /** Folder names that already exist, so "move" offers a list instead of a blank box. */
  folders?: string[];
  /** Projects this session can be tied to. Omit them and the action is absent —
   *  a surface with no project scope (a browser-local draft) never offers one. */
  projects?: Project[];
  linkedProjectIds?: number[];
  onLinkProject?: (projectId: number) => void | Promise<void>;
  onUnlinkProject?: (projectId: number) => void | Promise<void>;
  onRename: (title: string) => void | Promise<void>;
  onMove: (folder: string | null) => void | Promise<void>;
  onMerge?: (sourceId: string) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  extraActions?: SessionMenuAction[];
  localOnly?: boolean;
}

type Editor = 'rename' | 'move' | 'merge' | 'project' | null;

/**
 * What can be DONE to one session, and the form that does it.
 *
 * The behaviour lives here so a surface only has to decide how the actions are
 * PRESENTED — `SessionActionBar` renders them where the reader can see them,
 * and nothing has to re-derive the confirm copy or the folder list to do it.
 */
export function useSessionManagement({ session, mergeCandidates = [], folders = [], projects = [], linkedProjectIds = [], onLinkProject, onUnlinkProject, onRename, onMove, onMerge, onDelete, extraActions = [], localOnly = false }: SessionManagementPorts): { actions: SessionMenuAction[]; editor: ReactNode } {
  const t = useTranslations('sessionManagement');
  const confirm = useConfirm();
  const [editor, setEditor] = useState<Editor>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const openEditor = (next: Exclude<Editor, null>) => {
    setValue(next === 'rename' ? session.title : next === 'move' ? session.folder ?? '' : next === 'merge' ? mergeCandidates[0]?.id ?? '' : '');
    setError('');
    setEditor(next);
  };

  const submit = async () => {
    if (!editor) return;
    // The project editor ties as you go — closing it IS the submit.
    if (editor === 'project') { setEditor(null); return; }
    if ((editor === 'rename' || editor === 'merge') && !value.trim()) { setError(t('required')); return; }
    setBusy(true);
    setError('');
    try {
      if (editor === 'rename') await onRename(value.trim());
      if (editor === 'move') await onMove(value.trim() || null);
      if (editor === 'merge' && onMerge) {
        const source = mergeCandidates.find((candidate) => candidate.id === value);
        if (!source) { setError(t('required')); return; }
        const approved = await confirm({
          title: t('mergeConfirmTitle'),
          message: t(localOnly ? 'mergeConfirmMessageLocal' : 'mergeConfirmMessageSaved', { source: source.title, target: session.title }),
          confirmLabel: t('merge'),
          destructive: false,
        });
        if (!approved) return;
        await onMerge(source.id);
      }
      setEditor(null);
    } catch (reason) {
      setError(faultText(reason, t('failed')));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const approved = await confirm({
      title: t('deleteConfirmTitle'),
      message: t(localOnly ? 'deleteConfirmMessageLocal' : 'deleteConfirmMessageSaved', { title: session.title }),
      confirmLabel: t('delete'),
      destructive: true,
    });
    if (approved) await onDelete();
  };

  const actions: SessionMenuAction[] = [
    { id: 'rename', label: t('rename'), icon: 'edit', run: () => openEditor('rename') },
    { id: 'move', label: t('move'), icon: 'folder', run: () => openEditor('move') },
    { id: 'merge', label: t('merge'), icon: 'workflow', disabled: !onMerge || mergeCandidates.length === 0, run: () => openEditor('merge') },
    ...(onLinkProject && onUnlinkProject ? [{ id: 'project', label: t('project'), icon: 'project' as const, run: () => openEditor('project') }] : []),
    ...extraActions,
    { id: 'delete', label: t('delete'), icon: 'trash', danger: true, run: remove },
  ];

  return {
    actions,
    editor: editor && (
      <SessionEditorPanel
        open
        title={t(`${editor}Title`)}
        description={t(`${editor}Description`)}
        submitLabel={editor === 'project' ? t('done') : t(editor)}
        busy={busy}
        error={error}
        onSubmit={() => void submit()}
        onClose={() => setEditor(null)}
      >
        {editor === 'merge' ? (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="session-merge-source">{t('mergeSource')}</label>
            <Select id="session-merge-source" value={value} onChange={(event) => setValue(event.target.value)} aria-label={t('mergeSource')}>
              {mergeCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
            </Select>
          </div>
        ) : editor === 'move' ? (
          <FolderField value={value} folders={folders} onChange={setValue} />
        ) : editor === 'project' && onLinkProject && onUnlinkProject ? (
          <SessionProjectField linkedProjectIds={linkedProjectIds} projects={projects} onLink={onLinkProject} onUnlink={onUnlinkProject} />
        ) : (
          <TextField id="session-rename-value" autoFocus label={t('nameLabel')} value={value} onChange={(event) => setValue(event.target.value)} />
        )}
      </SessionEditorPanel>
    ),
  };
}
