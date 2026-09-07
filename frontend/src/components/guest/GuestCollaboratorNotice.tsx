'use client';

import { useTranslations } from 'next-intl';
import { useOptionalAuth } from '@/lib/AuthContext';
import { registerHref } from '@/lib/auth';

/**
 * "You are here as a guest" — for somebody who took a canvas invite link and declined
 * to sign up.
 *
 * ── WHY IT IS NOT THE USUAL GUEST WALL ───────────────────────────────────────────
 * `GuestAccountPrompt` exists for a visitor who has hit something they cannot do
 * without an account. This person is in the opposite position: they ARE a member of
 * this board, everything they do here is saved, and nothing is being withheld. Showing
 * them a wall would be a lie. What they are missing is a workspace of their OWN — which
 * is an offer, not a gate, and is worded as one.
 *
 * ── IT DECIDES ITS OWN VISIBILITY ────────────────────────────────────────────────
 * A link guest is `accountType === 'guest'` (the passwordless identity the claim minted),
 * and that is the only thing that puts this on screen. No caller passes a flag, so a
 * second surface that mounts it cannot show it to a signed-up member by mistake — and it
 * degrades to nothing outside an auth provider rather than crashing the tree.
 */
export function GuestCollaboratorNotice() {
  const t = useTranslations('creationCanvas');
  const auth = useOptionalAuth();
  if (auth?.user?.accountType !== 'guest') return null;

  return (
    <section className="gcn-root">
      <strong>{t('guestNoticeTitle')}</strong>
      <p>{t('guestNoticeBody')}</p>
      <a href={registerHref()}>{t('guestNoticeCta')}</a>

      <style>{`
        .gcn-root {
          display: grid; gap: 4px; margin-top: 10px; padding-top: 10px;
          border-top: 1px solid var(--border-subtle);
        }
        .gcn-root strong { font-size: var(--font-size-small); color: var(--text-primary); }
        .gcn-root p { margin: 0; font-size: var(--font-size-eyebrow); color: var(--text-secondary); }
        .gcn-root a {
          justify-self: start; margin-top: 4px; padding: 6px 12px;
          font-size: var(--font-size-small); font-weight: 600; text-decoration: none;
          border-radius: var(--radius-md); border: 1px solid var(--accent);
          background: var(--accent); color: var(--text-on-accent); min-height: 32px;
          display: inline-flex; align-items: center;
        }
      `}</style>
    </section>
  );
}
