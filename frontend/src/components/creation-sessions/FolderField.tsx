'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { TextField } from '@/components/ui';
import styles from './FolderField.module.css';

/** Sentinel for the "make a new one" row — never a real folder name. */
const NEW_FOLDER = '__bf_new_folder__';

interface Props {
  /** The folder name being written, `''` for none. */
  value: string;
  /** Folder names that already exist on this surface. */
  folders: string[];
  onChange: (folder: string) => void;
}

/**
 * Picks a folder by NAME from the ones that already exist, rather than asking
 * the reader to retype one from memory: a blank text box gave no hint that
 * folders were a list at all, so the same folder was created twice under two
 * spellings and "move" read as "invent".
 */
export function FolderField({ value, folders, onChange }: Props) {
  const t = useTranslations('sessionManagement');
  const [creating, setCreating] = useState(() => value !== '' && !folders.includes(value));
  const choose = (next: string) => {
    if (next === NEW_FOLDER) { setCreating(true); onChange(''); return; }
    setCreating(false);
    onChange(next);
  };
  return (
    <div className={styles.root}>
      <label className={styles.label} htmlFor="session-folder">{t('folderLabel')}</label>
      <Select id="session-folder" className={styles.select} value={creating ? NEW_FOLDER : value} onChange={(event) => choose(event.target.value)} aria-label={t('folderLabel')}>
        <option value="">{t('folderNone')}</option>
        {folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
        <option value={NEW_FOLDER}>{t('folderNew')}</option>
      </Select>
      {creating && <TextField id="session-folder-new" autoFocus label={t('folderNewLabel')} value={value} onChange={(event) => onChange(event.target.value)} />}
      <p className={styles.hint}>{t('folderHint')}</p>
    </div>
  );
}
