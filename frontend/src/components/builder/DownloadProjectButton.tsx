// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';
import { useDownloadProject } from './useDownloadProject';
import styles from './workspaceChrome.module.css';

/**
 * The ONE "Download project" control — the workspace's More menu (`menuItem`) and the
 * canvas App surface's panel glyphs (`icon`, styled by the segmented group around it).
 * The project's source as a zip (`lib/workspace/downloadProject.ts`).
 */
export function DownloadProjectButton({ store, name, variant, onDone }: {
  store: WorkspaceFileStore;
  /** Names the archive: `My App` → `my-app.zip`. */
  name: string;
  variant: 'icon' | 'menuItem';
  /** After the browser has the file — the menu closes itself. */
  onDone?: () => void;
}) {
  const t = useTranslations('ide');
  const { download, busy, error } = useDownloadProject(store, name);
  const label = busy ? t('workspace.downloadingProject') : t('workspace.downloadProject');
  const hint = error ?? t('workspace.downloadProjectHint');
  const run = () => { void download().then((done) => { if (done) onDone?.(); }); };

  if (variant === 'icon') {
    return (
      <button type="button" onClick={run} disabled={busy} aria-busy={busy} aria-label={label} title={error ?? label}>
        <Icon name={error ? 'warning' : 'download'} size={15} />
      </button>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      className={styles.menuItem}
      onClick={run}
      disabled={busy}
      aria-busy={busy}
      title={hint}
    >
      <Icon name={error ? 'warning' : 'download'} size={16} />
      <span style={{ display: 'grid', minWidth: 0 }}>
        <span>{label}</span>
        {error && <span role="alert" style={{ color: 'var(--error-text)', fontSize: 'var(--font-size-eyebrow)', whiteSpace: 'normal' }}>{error}</span>}
      </span>
    </button>
  );
}
