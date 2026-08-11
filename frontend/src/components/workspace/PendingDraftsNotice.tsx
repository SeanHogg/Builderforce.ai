'use client';

import { Icon } from '@/components/ui/Icon';
import { SessionManagementControls } from '@/components/creation-sessions/SessionManagementControls';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { listPendingDrafts } from '@/lib/pendingWork';
import { mergeLocalCreationSessions, removeLocalCreationSession, updateLocalCreationSession, type LocalCreationEntry } from '@/lib/creationSessions';

/**
 * Account-less boards still held in this browser, surfaced in the canvas library.
 *
 * The shell-level <ResumeWorkBridge> claims these automatically once a tenant
 * exists, so in the ordinary flow this renders nothing. It exists for the case
 * the bridge cannot cover: a claim that failed (offline, session quota reached)
 * would otherwise leave real work sitting in localStorage with no surface
 * admitting it is there. Self-gating — no pending drafts, no notice.
 */
export function PendingDraftsNotice() {
  const t = useTranslations('canvasLibrary');
  const [drafts, setDrafts] = useState<LocalCreationEntry[]>([]);

  useEffect(() => { setDrafts(listPendingDrafts()); }, []);

  const refresh = () => setDrafts(listPendingDrafts());
  const rename = (draft: LocalCreationEntry, title: string) => {
    updateLocalCreationSession(draft.sessionId, { title });
    refresh();
  };
  const move = (draft: LocalCreationEntry, folder: string | null) => {
    updateLocalCreationSession(draft.sessionId, { folder });
    refresh();
  };
  const remove = (draft: LocalCreationEntry) => {
    removeLocalCreationSession(draft.sessionId);
    refresh();
  };
  const merge = (target: LocalCreationEntry, sourceId: string) => {
    mergeLocalCreationSessions(target.sessionId, [sourceId]);
    refresh();
  };

  if (drafts.length === 0) return null;

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
            <SessionManagementControls
              session={{ id: draft.sessionId, title: draft.title, folder: draft.folder }}
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
