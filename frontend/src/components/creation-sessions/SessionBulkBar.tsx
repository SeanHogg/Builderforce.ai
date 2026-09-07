'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { Select } from '@/components/Select';
import { Button, Icon } from '@/components/ui';
import { faultText } from '@/lib/apiClient';
import { SessionEditorPanel } from './SessionEditorPanel';
import panelStyles from './SessionEditorPanel.module.css';
import styles from './SessionBulkBar.module.css';
import type { ManagedSession } from './useSessionManagement';

interface Props {
  selected: ManagedSession[];
  /** Whether the library is showing archived sessions — the same button restores them. */
  archived: boolean;
  onMerge: (targetId: string, sourceIds: string[]) => Promise<void>;
  onArchive: (ids: string[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
  onClear: () => void;
}

/**
 * Bulk actions over the checked sessions.
 *
 * Self-gating: nothing checked, nothing rendered — the library does not have to
 * decide when the bar belongs on screen. Merge is offered from two sessions up,
 * because merging one into itself is not an operation.
 */
export function SessionBulkBar({ selected, archived, onMerge, onArchive, onDelete, onClear }: Props) {
  const t = useTranslations('sessionManagement');
  const confirm = useConfirm();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (selected.length === 0) return null;
  const ids = selected.map((session) => session.id);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } finally { setBusy(false); }
  };

  const openMerge = () => { setTarget(selected[0]?.id ?? ''); setError(''); setMergeOpen(true); };
  const submitMerge = async () => {
    const keep = selected.find((session) => session.id === target);
    if (!keep) { setError(t('required')); return; }
    const sources = ids.filter((id) => id !== keep.id);
    const approved = await confirm({
      title: t('bulkMergeConfirmTitle'),
      message: t('bulkMergeConfirmMessage', { count: sources.length, target: keep.title }),
      confirmLabel: t('merge'),
      destructive: false,
    });
    if (!approved) return;
    setBusy(true);
    setError('');
    try {
      await onMerge(keep.id, sources);
      setMergeOpen(false);
    } catch (reason) {
      setError(faultText(reason, t('failed')));
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = async () => {
    const approved = await confirm({
      title: t('bulkDeleteConfirmTitle'),
      message: t('bulkDeleteConfirmMessage', { count: ids.length }),
      confirmLabel: t('delete'),
      destructive: true,
    });
    if (approved) await run(() => onDelete(ids));
  };

  return (
    <div className={styles.bar} role="region" aria-label={t('bulkLabel')}>
      <strong className={styles.count}>{t('bulkSelected', { count: ids.length })}</strong>
      <div className={styles.actions}>
        <Button type="button" variant="secondary" size="sm" disabled={busy || ids.length < 2} onClick={openMerge}>
          <Icon name="workflow" size={16} /> {t('merge')}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => onArchive(ids))}>
          <Icon name="archive" size={16} /> {archived ? t('bulkRestore') : t('bulkArchive')}
        </Button>
        <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void removeSelected()}>
          <Icon name="trash" size={16} /> {t('delete')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClear}>
          <Icon name="close" size={16} /> {t('bulkClear')}
        </Button>
      </div>
      {mergeOpen && (
        <SessionEditorPanel
          open
          title={t('bulkMergeTitle')}
          description={t('bulkMergeDescription')}
          submitLabel={t('merge')}
          busy={busy}
          error={error}
          onSubmit={() => void submitMerge()}
          onClose={() => setMergeOpen(false)}
        >
          <div className={panelStyles.field}>
            <label className={panelStyles.fieldLabel} htmlFor="bulk-merge-target">{t('bulkMergeTarget')}</label>
            <Select id="bulk-merge-target" value={target} onChange={(event) => setTarget(event.target.value)} aria-label={t('bulkMergeTarget')}>
              {selected.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
            </Select>
          </div>
        </SessionEditorPanel>
      )}
    </div>
  );
}
