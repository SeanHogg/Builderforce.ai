'use client';

import { useTranslations } from 'next-intl';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { guestRoomInviteUrl, type GuestRoomSurface } from '@/lib/guestRoomApi';

/**
 * The invite link for a shared free session — the ONE place the link is built,
 * copied, and confirmed.
 *
 * Both surfaces that can host a room render this: the guest chat's room bar and
 * the Creation Canvas share menu. They differ in chrome, not in behaviour, and a
 * second copy would be a second chance to point the link at the wrong surface or
 * to swallow a refused clipboard.
 *
 * The URL itself is always shown, not hidden behind a button. Clipboard access
 * needs a secure context and can be refused by permission policy, and a share
 * affordance that can silently fail is worse than one you can read and select by
 * hand — so `copy` is the convenience, and the visible link is the guarantee.
 */
export function GuestInviteLink({
  code, surface, full = false, compact = false,
}: {
  code: string;
  surface: GuestRoomSurface;
  /** The room has no seats left — copying it would only disappoint whoever gets it. */
  full?: boolean;
  /** Tighter layout for the chat's room bar. */
  compact?: boolean;
}) {
  const t = useTranslations('guestRoom');
  const { copy, state } = useCopyToClipboard();
  const url = guestRoomInviteUrl(code, surface);

  return (
    <div className={`gil-root ${compact ? 'gil-compact' : ''}`}>
      <div className="gil-row">
        <input
          className="gil-url"
          value={url}
          readOnly
          aria-label={t('inviteLink')}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          className="gil-copy"
          disabled={full}
          onClick={() => { void copy(url); }}
        >
          {full ? t('roomFull') : state === 'copied' ? t('linkCopied') : t('copyInvite')}
        </button>
      </div>
      {state === 'error' && <p className="gil-error" role="alert">{t('copyFallback')}</p>}

      <style>{`
        .gil-root { display: flex; flex-direction: column; gap: 6px; width: 100%; min-width: 0; }
        .gil-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .gil-url {
          flex: 1 1 180px; min-width: 0; box-sizing: border-box;
          padding: 7px 9px; font-size: var(--font-size-small); font-family: inherit;
          border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
          background: var(--bg-base); color: var(--text-primary);
          text-overflow: ellipsis;
        }
        .gil-copy {
          flex: 0 0 auto; padding: 7px 12px; font-size: var(--font-size-small); font-weight: 600;
          border-radius: var(--radius-md); border: 1px solid var(--accent);
          background: var(--accent); color: var(--text-on-accent); cursor: pointer; min-height: 32px;
        }
        .gil-copy:disabled { opacity: 0.55; cursor: default; }
        .gil-error { margin: 0; font-size: var(--font-size-eyebrow); color: var(--danger); }
        .gil-compact .gil-url { font-size: var(--font-size-eyebrow); padding: 5px 8px; }
        @media (max-width: 420px) {
          .gil-row { flex-direction: column; align-items: stretch; }
          .gil-copy { width: 100%; }
        }
      `}</style>
    </div>
  );
}
