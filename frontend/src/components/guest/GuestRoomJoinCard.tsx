'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { joinGuestRoom, getGuestDisplayName, setGuestDisplayName, type GuestRoomState } from '@/lib/guestRoomApi';

/**
 * What an invite link lands on: pick a name, step into the shared session.
 *
 * Both entry points render this — the guest chat (`/brainstorm?room=`) and the
 * Creation Canvas (`/create/new?room=`). Joining is the same act either way, and
 * the join itself lives HERE rather than in each caller, so neither can forget to
 * persist the display name or to handle a room that filled up while the invitee
 * was reading the link.
 */
export function GuestRoomJoinCard({
  code, onJoined, blurb,
}: {
  code: string;
  /** The room this visitor just entered. */
  onJoined: (state: GuestRoomState) => void;
  /** Surface-specific line under the title (defaults to the chat wording). */
  blurb?: string;
}) {
  const t = useTranslations('guestRoom');
  const [name, setName] = useState(() => getGuestDisplayName());
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setJoining(true);
    setError(null);
    const chosen = name.trim() || t('defaultGuestName');
    setGuestDisplayName(chosen);
    const state = await joinGuestRoom(code, chosen);
    if (typeof state === 'string') {
      setError(state === 'unavailable' ? t('errorUnavailable') : t('errorGone'));
      setJoining(false);
      return;
    }
    setJoining(false);
    onJoined(state);
  };

  return (
    <div className="grj-root">
      <div className="grj-emoji" aria-hidden>👋</div>
      <div className="grj-title">{t('inviteTitle')}</div>
      <div className="grj-body">{blurb ?? t('inviteBody')}</div>
      <form className="grj-form" onSubmit={(e) => { e.preventDefault(); void join(); }}>
        <label className="grj-label" htmlFor={`grj-name-${code}`}>{t('yourName')}</label>
        <input
          id={`grj-name-${code}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('namePlaceholder')}
          maxLength={40}
          className="grj-input"
        />
        <button type="submit" disabled={joining} className="grj-join">
          {joining ? t('joining') : t('joinSession')}
        </button>
      </form>
      {error && <p className="grj-error" role="alert">{error}</p>}
      <style>{`
        .grj-root { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center; color: var(--text-muted); }
        .grj-emoji { font-size: 40px; }
        .grj-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }
        .grj-body { font-size: 14px; line-height: 1.5; max-width: 360px; }
        .grj-form { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 320px; margin-top: 6px; text-align: left; }
        .grj-label { font-size: 12px; font-weight: 600; color: var(--text-primary); }
        .grj-input { width: 100%; box-sizing: border-box; padding: 9px 11px; font-size: 14px; font-family: inherit; border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--bg-base); color: var(--text-primary); }
        .grj-join { padding: 10px 20px; font-size: 14px; font-weight: 600; border: none; border-radius: 10px; background: var(--accent, #3b82f6); color: #fff; cursor: pointer; min-height: 40px; }
        .grj-join:disabled { opacity: 0.55; cursor: default; }
        .grj-error { margin: 0; font-size: 13px; color: var(--danger, #dc2626); }
      `}</style>
    </div>
  );
}
