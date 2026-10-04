// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { ProjectVersions } from './useProjectVersions';
import styles from './workspaceChrome.module.css';

/**
 * "Saved · v3" in the workspace header: that the work is kept, and how many
 * versions there are to go back to. Opens the Versions panel. Renders nothing
 * until the versions have loaded, or for a workspace without them.
 */
export function WorkspaceVersionChip({ versions, onOpen }: { versions: ProjectVersions; onOpen: () => void }) {
  const t = useTranslations('ide.workspace');
  const count = versions.versions?.length ?? 0;
  if (count === 0) return null;
  const label = t('savedVersion', { number: count });
  return (
    <button type="button" className={styles.ghostChip} onClick={onOpen} title={t('versionsHint')} aria-label={`${label} — ${t('versionsHint')}`}>
      <Icon name="clock" size={14} />
      <span className={styles.ghostChipLabel}>{label}</span>
    </button>
  );
}
