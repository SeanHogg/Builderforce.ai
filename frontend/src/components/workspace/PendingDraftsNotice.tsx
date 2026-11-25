import { Icon } from '@/components/ui/Icon';
import { SessionActionBar } from '@/components/creation-sessions/SessionActionBar';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { listPendingDrafts, reportStudioFailure, mergeLocalCreationSessions, removeLocalCreationSession, updateLocalCreationSession, type LocalCreationEntry } from '@/lib/pendingWork';

/**
 * Account-less boards still held in this browser, surfaced in the canvas library.
 *
 * The shell-level <ResumeWorkBridge> claims these automatically once a tenant
 * exists, so in the ordinary flow this renders nothing. It exists for the case
 * the bridge cannot cover: a claim that failed (offline, session quota reached)
 * would otherwise leave real work sitting on this device with no surface
 * admitting it is there. Self-gating — no pending drafts, no notice.
 */
export function PendingDraftsNotice() {
  const t = useTranslations('canvasLibrary');
  const [drafts, setDrafts] = useState<LocalCreationEntry[]>([]);

  const refresh = useCallback(() => {
    void listPendingDrafts().then(setDrafts).catch((error: unknown) => void reportStudioFailure('PendingDraftsNotice.list', error));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  /** One edit of a draft, then the list again — a failed edit is reported, never swallowed. */
  const edit = (work: Promise<unknown>) => {
    void work.catch((error: unknown) => void reportStudioFailure('PendingDraftsNotice.edit', error)).finally(refresh);
  };
  const rename = (draft: LocalCreationEntry, title: string) => edit(updateLocalCreationSession(draft.sessionId, { title }));
  const move = (draft: LocalCreationEntry, folder: string | null) => edit(updateLocalCreationSession(draft.sessionId, { folder }));
  const remove = (draft: LocalCreationEntry) => edit(removeLocalCreationSession(draft.sessionId));
  const merge = (target: LocalCreationEntry, sourceId: string) => edit(mergeLocalCreationSessions(target.sessionId, [sourceId]));

  if (drafts.length === 0) return null;

  // The folders these drafts already sit in — the move picker offers the list
  // rather than a blank box, exactly as the saved library does.
  const folderNames = [...new Set(drafts.map((draft) => draft.folder).filter((folder): folder is string => !!folder))].sort((a, b) => a.localeCompare(b));

  return (
    <section
      aria-label={t('pendingTitle')}
      style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: 16, borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{t('pendingTitle')}</strong>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t('pendingHint')}</span>
      </div>
      {[...new Set(drafts.map((draft) => draft.folder || ''))].map((folder) => (
        <div key={folder || '__unfiled'} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {folder && <strong className="ui-text-small" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--text-secondary)' }}><Icon name="folder" size={14} /> {folder}</strong>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {drafts.filter((draft) => (draft.folder || '') === folder).map((draft) => (
          <li key={draft.sessionId} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Link
              href={`/create/${draft.sessionId}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                minHeight: 40, padding: '8px 14px', borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border)', background: 'var(--bg-surface)',
                color: 'var(--text-primary)', textDecoration: 'none', fontSize: '0.88rem', fontWeight: 600,
              }}
            >
              <span aria-hidden="true"><Icon source="✦" size="1em" /></span>
              {draft.title || t('untitled')}
            </Link>
            <SessionActionBar
              session={{ id: draft.sessionId, title: draft.title, folder: draft.folder }}
              folders={folderNames}
              mergeCandidates={drafts.filter((candidate) => candidate.sessionId !== draft.sessionId).map((candidate) => ({ id: candidate.sessionId, title: candidate.title, folder: candidate.folder }))}
              onRename={(title) => rename(draft, title)}
              onMove={(folderName) => move(draft, folderName)}
              onMerge={(sourceId) => merge(draft, sourceId)}
              onDelete={() => remove(draft)}
              localOnly
            />
          </li>
          ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
