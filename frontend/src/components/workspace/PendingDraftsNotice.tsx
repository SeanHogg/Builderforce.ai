'use client';

import { Icon } from '@/components/ui/Icon';
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
  const rename = (draft: LocalCreationEntry) => {
    const title = window.prompt(t('renameSession'), draft.title)?.trim();
    if (!title) return;
    updateLocalCreationSession(draft.sessionId, { title });
    refresh();
  };
  const move = (draft: LocalCreationEntry) => {
    const folder = window.prompt(t('moveSessionPrompt'), draft.folder ?? '')?.trim();
    if (folder === undefined) return;
    updateLocalCreationSession(draft.sessionId, { folder: folder || null });
    refresh();
  };
  const remove = (draft: LocalCreationEntry) => {
    if (!window.confirm(t('deleteSessionConfirm', { title: draft.title }))) return;
    removeLocalCreationSession(draft.sessionId);
    refresh();
  };
  const merge = (target: LocalCreationEntry) => {
    const choices = drafts.filter((draft) => draft.sessionId !== target.sessionId);
    if (!choices.length) return;
    const sourceTitle = window.prompt(t('mergeSessionPrompt', { sessions: choices.map((draft) => draft.title).join(', ') }))?.trim();
    if (!sourceTitle) return;
    const source = choices.find((draft) => draft.title.toLocaleLowerCase() === sourceTitle.toLocaleLowerCase());
    if (!source) { window.alert(t('mergeSessionNotFound')); return; }
    if (!window.confirm(t('mergeSessionConfirm', { source: source.title, target: target.title }))) return;
    mergeLocalCreationSessions(target.sessionId, [source.sessionId]);
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
          {folder && <strong style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>📁 {folder}</strong>}
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
            <button type="button" onClick={() => rename(draft)} aria-label={t('renameSession')} title={t('renameSession')}>✎</button>
            <button type="button" onClick={() => move(draft)} aria-label={t('moveSession')} title={t('moveSession')}>📁</button>
            <button type="button" onClick={() => merge(draft)} disabled={drafts.length < 2} aria-label={t('mergeSession')} title={t('mergeSession')}>⇆</button>
            <button type="button" onClick={() => remove(draft)} aria-label={t('deleteSession')} title={t('deleteSession')} style={{ color: 'var(--danger)' }}>×</button>
          </li>
          ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
