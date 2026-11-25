import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SyncConflict } from '@builderforce/local-first';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Button } from '@/components/ui';
import { reportLocalFirstFailure } from '@/lib/localFirst/reportLocalFirstFailure';
import type { ConflictChoice } from '@/domains/canvas/infrastructure/localFirst/boardConflicts';

export interface BoardConflictsPanelProps {
  conflicts: readonly SyncConflict[];
  resolve: (conflictId: string, choice: ConflictChoice) => Promise<void>;
}

/** The title a conflicted object is shown by: what its payload calls itself, else its kind. */
function objectLabel(conflict: SyncConflict, fallback: string): string {
  const payload = (conflict.local.payload ?? {}) as { content?: { title?: unknown }; canvasData?: { title?: unknown }; kind?: unknown };
  const title = payload.content?.title ?? payload.canvasData?.title;
  if (typeof title === 'string' && title.trim()) return title;
  return typeof payload.kind === 'string' ? payload.kind : fallback;
}

/**
 * Two writers edited the SAME object — one notice, and a side panel (never a modal: nothing here is a
 * destructive approval) to settle each. The person's own value stays on the board until they choose;
 * the other value is kept, never dropped. An edit against a deletion offers to keep the edit as a copy.
 */
export function BoardConflictsPanel({ conflicts, resolve }: BoardConflictsPanelProps) {
  const t = useTranslations('creationCanvas.conflicts');
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (conflicts.length === 0) return null;

  const settle = (id: string, choice: ConflictChoice) => {
    setBusyId(id);
    void resolve(id, choice)
      .catch((error: unknown) => reportLocalFirstFailure('BoardConflictsPanel.resolve', error))
      .finally(() => setBusyId(null));
  };

  return (
    <>
      <button
        type="button"
        className="ui-text-small"
        onClick={() => setOpen(true)}
        style={{
          maxWidth: 'calc(100vw - 32px)', padding: '4px 12px', borderRadius: 'var(--radius-full)',
          border: '1px solid var(--warning)', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        {t('notice', { count: conflicts.length })}
      </button>
      <SlideOutPanel open={open} onClose={() => setOpen(false)} title={t('title')} width="sheet">
        <p style={{ color: 'var(--text-secondary)', margin: '0 0 var(--space-2)' }}>{t('hint')}</p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {conflicts.map((conflict) => (
            <li key={conflict.id} style={{ padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <strong style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{objectLabel(conflict, t('object'))}</strong>
              <span className="ui-text-small" style={{ color: 'var(--text-secondary)' }}>
                {conflict.reason === 'edit_vs_remote_delete' ? t('reasonDeleted') : t('reasonEdited')}
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {conflict.reason === 'edit_vs_remote_delete' ? (
                  <>
                    <Button size="sm" variant="primary" disabled={busyId === conflict.id} onClick={() => settle(conflict.id, 'restore-copy')}>{t('restoreCopy')}</Button>
                    <Button size="sm" variant="secondary" disabled={busyId === conflict.id} onClick={() => settle(conflict.id, 'theirs')}>{t('keepTheirs')}</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="primary" disabled={busyId === conflict.id} onClick={() => settle(conflict.id, 'mine')}>{t('keepMine')}</Button>
                    <Button size="sm" variant="secondary" disabled={busyId === conflict.id} onClick={() => settle(conflict.id, 'theirs')}>{t('keepTheirs')}</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </SlideOutPanel>
    </>
  );
}
