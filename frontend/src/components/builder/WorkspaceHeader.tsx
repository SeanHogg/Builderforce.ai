// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import styles from './workspaceChrome.module.css';

/**
 * The workspace's ONE header row: where you are (projects, the host's mark, the
 * project's name and type), what you are looking at (the view switch, centred),
 * and what you can do (the workspace's own controls, then the host's — Share,
 * Publish, the account).
 *
 * A host that wraps the workspace (Studio) hands its brand and actions in as
 * `leading` / `trailing` instead of stacking a second bar above this one — two
 * bars of actions was the single most confusing thing about the Studio.
 */
export function WorkspaceHeader({ leading, title, typeIcon, typeLabel, center, actions, trailing, onOpenProjects }: {
  leading?: ReactNode;
  title: ReactNode;
  typeIcon: string;
  typeLabel: string;
  center?: ReactNode;
  actions?: ReactNode;
  trailing?: ReactNode;
  onOpenProjects: () => void;
}) {
  const t = useTranslations('ide');
  return (
    <header className={styles.header}>
      <div className={styles.headerStart}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onOpenProjects}
          aria-label={t('openProjectsAria')}
          title={t('yourIdeProjects')}
        >
          <Icon name="apps" size={18} />
        </button>
        {leading}
        <button type="button" className={styles.crumb} onClick={onOpenProjects}>{t('workspace.projects')}</button>
        <span className={styles.crumbSep} aria-hidden>/</span>
        {title}
        <span className={styles.chip} title={t('modalityProject', { label: typeLabel })}>
          <Icon source={typeIcon} size={14} />
          {typeLabel}
        </span>
      </div>
      {center && <div className={styles.headerCenter}>{center}</div>}
      <div className={styles.headerEnd}>
        {actions}
        {trailing}
      </div>
    </header>
  );
}
