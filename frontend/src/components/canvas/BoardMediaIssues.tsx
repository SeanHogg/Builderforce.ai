import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Button } from '@/components/ui';
import type { BoardMediaIssue } from '@/domains/canvas/infrastructure/localFirst/mediaUploadStatus';

export interface BoardMediaIssuesProps {
  issues: readonly BoardMediaIssue[];
  /** Never rejects: a failure is reported by the hook. */
  retry: (mediaId: string) => Promise<void>;
}

/**
 * Uploads that did not go: one notice, and a side panel listing each failed one with a Retry. An item
 * the queue is backing off from is listed as "will retry shortly" and needs nothing. The media stays
 * on this device and on the board meanwhile — a failed upload loses nothing.
 */
export function BoardMediaIssues({ issues, retry }: BoardMediaIssuesProps) {
  const t = useTranslations('studio.media');
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (issues.length === 0) return null;

  const again = (id: string) => {
    setBusyId(id);
    // `retry` reports its own failure and never rejects.
    void retry(id).finally(() => setBusyId(null));
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
        {t('failedTitle')} ({issues.length})
      </button>
      <SlideOutPanel open={open} onClose={() => setOpen(false)} title={t('failedTitle')} width="sheet">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {issues.map((issue) => (
            <li key={issue.id} style={{ padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <strong style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{issue.name}</strong>
              {issue.status === 'retrying'
                ? <span className="ui-text-small" style={{ color: 'var(--text-secondary)' }}>{t('retrying')}</span>
                : <div><Button size="sm" variant="primary" disabled={busyId === issue.id} onClick={() => again(issue.id)}>{t('retry')}</Button></div>}
            </li>
          ))}
        </ul>
      </SlideOutPanel>
    </>
  );
}
