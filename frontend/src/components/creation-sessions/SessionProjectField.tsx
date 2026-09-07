'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { Button, Icon } from '@/components/ui';
import type { Project } from '@/lib/types';
import styles from './SessionProjectField.module.css';

interface Props {
  /** Projects this session is tied to already. */
  linkedProjectIds: number[];
  projects: Project[];
  onLink: (projectId: number) => void | Promise<void>;
  onUnlink: (projectId: number) => void | Promise<void>;
}

/**
 * Ties a session to Projects, and unties it.
 *
 * The ties act as they are made rather than on a submit — there is no draft
 * here to lose, and the badges are the same ones the tile shows, so what the
 * reader sees on the card is what this edits.
 */
export function SessionProjectField({ linkedProjectIds, projects, onLink, onUnlink }: Props) {
  const t = useTranslations('sessionManagement');
  const [busy, setBusy] = useState(false);
  const linked = linkedProjectIds.flatMap((id) => projects.filter((project) => project.id === id));
  const available = projects.filter((project) => !linkedProjectIds.includes(project.id));

  const run = async (work: () => void | Promise<void>) => {
    setBusy(true);
    try { await work(); } finally { setBusy(false); }
  };

  return (
    <div className={styles.root}>
      <span className={styles.label}>{t('projectsLabel')}</span>
      {linked.length === 0 && <p className={styles.empty}>{t('projectsEmpty')}</p>}
      <ul className={styles.list}>
        {linked.map((project) => (
          <li key={project.id} className={styles.tie}>
            {project.name}
            <Button type="button" variant="ghost" size="sm" disabled={busy} className={styles.untie} aria-label={t('untieProject', { project: project.name })} onClick={() => void run(() => onUnlink(project.id))}>
              <Icon name="close" size={14} />
            </Button>
          </li>
        ))}
      </ul>
      {available.length > 0 && (
        <Select value="" disabled={busy} onChange={(event) => { if (event.target.value) void run(() => onLink(Number(event.target.value))); }} aria-label={t('tieToProject')}>
          <option value="">{t('tieToProject')}</option>
          {available.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </Select>
      )}
    </div>
  );
}
