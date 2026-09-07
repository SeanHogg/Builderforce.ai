'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { faultText } from '@/lib/apiClient';
import { canvasWebOrigin } from '@/lib/canvasHost';
import { ShareLinkField } from '@/components/share/ShareLinkField';
import {
  creationSessionsApi,
  type CanvasInviteLink,
  type CanvasInviteLinkRole,
  type CreationSessionSummary,
  type MintedCanvasInviteLink,
} from '@/lib/builderforceApi';

/**
 * "Send someone the link" for a canvas that belongs to a workspace.
 *
 * ── WHAT IT CLOSES ───────────────────────────────────────────────────────────────
 * The share sheet had two completely different answers depending on whether you were
 * signed in. Signed OUT: a link, a copy button, done. Signed IN — the state you reach by
 * caring enough about the board to keep it — an address field, an email nobody may ever
 * open, and a recipient who must sign in as that exact address. This is the missing half,
 * and it renders in the SAME sheet beside the address field rather than replacing it:
 * both are real motions, and which one fits depends on whether you know the person's
 * email or only have a chat window open.
 *
 * ── IT DECIDES ITS OWN VISIBILITY ────────────────────────────────────────────────
 * Minting a link is giving access away to whoever it is forwarded to, so it is owner-only
 * — the same gate the API applies. The caller passes the board role it already has, not a
 * `canShare` boolean it computed: the rule lives here, once, so a second surface that
 * mounts this cannot mount it for the wrong person.
 *
 * ── WHY THE LIST HAS NO URLs ─────────────────────────────────────────────────────
 * Only a link's HASH is stored, so a listed link cannot be re-shown — which is a property
 * worth having, not a limitation to work around: a leaked link is revoked and re-minted,
 * never re-read. The list therefore says what each link grants and how often it has been
 * used, and the only action on it is revoke.
 */
export function CanvasInviteLinkPanel({ sessionId, role }: {
  sessionId: string;
  /** The CALLER's role on this board. */
  role: CreationSessionSummary['role'];
}) {
  const t = useTranslations('creationCanvas');
  const [links, setLinks] = useState<CanvasInviteLink[]>([]);
  const [minted, setMinted] = useState<MintedCanvasInviteLink | null>(null);
  const [linkRole, setLinkRole] = useState<CanvasInviteLinkRole>('editor');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const isOwner = role === 'owner';

  const refresh = useCallback(() => {
    creationSessionsApi.inviteLinks.list(sessionId)
      .then((result) => setLinks(result.links))
      .catch(() => setLinks([]));
  }, [sessionId]);

  useEffect(() => {
    if (!isOwner) return;
    refresh();
  }, [isOwner, refresh]);

  if (!isOwner) return null;

  const create = () => {
    setBusy(true);
    setNotice('');
    creationSessionsApi.inviteLinks.create(sessionId, { role: linkRole })
      .then((link) => { setMinted(link); refresh(); })
      .catch((error) => setNotice(faultText(error, t('inviteLinkFailed'))))
      .finally(() => setBusy(false));
  };

  const revoke = (linkId: string) => {
    creationSessionsApi.inviteLinks.revoke(sessionId, linkId)
      .then(() => {
        setMinted((current) => (current?.id === linkId ? null : current));
        setNotice(t('inviteLinkRevoked'));
        refresh();
      })
      .catch((error) => setNotice(faultText(error, t('inviteLinkRevokeFailed'))));
  };

  const roleLabel = (value: CanvasInviteLinkRole) =>
    value === 'viewer' ? t('roleViewer') : value === 'commenter' ? t('roleCommenter') : t('roleEditor');

  return (
    <section className="cilp-root" aria-label={t('inviteLinkHeading')}>
      <div className="cilp-head">
        <strong>{t('inviteLinkHeading')}</strong>
        <p>{t('inviteLinkHint')}</p>
      </div>

      <div className="cilp-mint">
        <select
          aria-label={t('inviteLinkRole')}
          value={linkRole}
          onChange={(event) => setLinkRole(event.target.value as CanvasInviteLinkRole)}
        >
          <option value="viewer">{t('roleViewer')}</option>
          <option value="commenter">{t('roleCommenter')}</option>
          <option value="editor">{t('roleEditor')}</option>
        </select>
        <button type="button" onClick={create} disabled={busy}>
          {busy ? t('inviteLinkCreating') : t('inviteLinkCreate')}
        </button>
      </div>

      {minted && (
        <div className="cilp-minted">
          <ShareLinkField url={`${canvasWebOrigin()}${minted.joinPath}`} ariaLabel={t('inviteLinkAriaLabel')} />
          <small>{t('inviteLinkCopyNow')}</small>
        </div>
      )}

      {!!links.length && (
        <ul className="cilp-list" aria-label={t('inviteLinkActive')}>
          {links.map((link) => (
            <li key={link.id}>
              <span className="cilp-role">{roleLabel(link.role)}</span>
              <small>{t('inviteLinkUses', { count: link.useCount })}</small>
              <button
                type="button"
                aria-label={t('inviteLinkRevoke')}
                title={t('inviteLinkRevoke')}
                onClick={() => revoke(link.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {notice && <p className="cilp-notice" role="status">{notice}</p>}

      <style>{`
        .cilp-root { display: grid; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-subtle); }
        .cilp-head strong { display: block; font-size: var(--font-size-small); color: var(--text-primary); }
        .cilp-head p { margin: 2px 0 0; font-size: var(--font-size-eyebrow); color: var(--text-secondary); }
        .cilp-mint { display: flex; gap: 6px; flex-wrap: wrap; }
        .cilp-mint select {
          flex: 1 1 120px; min-width: 0; padding: 6px 8px; font-size: var(--font-size-small); font-family: inherit;
          border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
          /* Native <option> lists inherit the SYSTEM palette, not this one, so the
             control must state an opaque background and foreground of its own or the
             open list is unreadable in one of the two themes. */
          background: var(--bg-base); color: var(--text-primary);
        }
        .cilp-mint select option { background: var(--bg-base); color: var(--text-primary); }
        .cilp-mint button {
          flex: 0 0 auto; padding: 6px 12px; font-size: var(--font-size-small); font-weight: 600;
          border-radius: var(--radius-md); border: 1px solid var(--border-subtle);
          background: var(--surface-raised); color: var(--text-primary); cursor: pointer; min-height: 32px;
        }
        .cilp-mint button:disabled { opacity: 0.55; cursor: default; }
        .cilp-minted { display: grid; gap: 4px; }
        .cilp-minted small { font-size: var(--font-size-eyebrow); color: var(--text-secondary); }
        .cilp-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
        .cilp-list li { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 6px; }
        .cilp-role { font-size: var(--font-size-small); color: var(--text-primary); }
        .cilp-list small { font-size: var(--font-size-eyebrow); color: var(--text-secondary); }
        .cilp-list button {
          border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
          background: transparent; color: var(--text-secondary); cursor: pointer;
          min-width: 28px; min-height: 28px; line-height: 1;
        }
        .cilp-notice { margin: 0; font-size: var(--font-size-eyebrow); color: var(--text-secondary); }
        @media (max-width: 420px) {
          .cilp-mint { flex-direction: column; align-items: stretch; }
          .cilp-mint button { width: 100%; }
        }
      `}</style>
    </section>
  );
}
