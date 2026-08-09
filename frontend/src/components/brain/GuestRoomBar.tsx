'use client';

import { useTranslations } from 'next-intl';
import { GuestInviteLink } from '@/components/guest/GuestInviteLink';
import type { GuestRoomParticipant, GuestRoomSurface } from '@/lib/guestRoomApi';

/**
 * The header strip of a SHARED free session: who is here, the invite link, and
 * the meeting toggle.
 *
 * It also carries the one number that matters in a room — the COMBINED turns
 * left. Everyone sees the same count because everyone is spending the same
 * budget; a per-person counter here would be a lie about how the room works.
 *
 * Rendered both by the docked drawer and the full-page guest room, so it decides
 * its own layout at narrow widths rather than being told.
 */
export function GuestRoomBar({
  code, title, surface, participants, maxParticipants, remaining, limit,
  connected, busyWith, meetingOn, onToggleMeeting, onLeave,
}: {
  code: string;
  title: string;
  /** Where this room's invite link should land people. */
  surface: GuestRoomSurface;
  participants: GuestRoomParticipant[];
  maxParticipants: number;
  /** Combined turns left for the whole room (null while unknown). */
  remaining: number | null;
  limit: number;
  connected: boolean;
  /** Display name of whoever is currently waiting on the Brain. */
  busyWith: string | null;
  meetingOn: boolean;
  onToggleMeeting: () => void;
  onLeave: () => void;
}) {
  const t = useTranslations('guestRoom');
  const full = participants.length >= maxParticipants;

  return (
    <div className="gr-bar">
      <div className="gr-bar-row">
        <span className="gr-bar-title" title={title}>
          <span className={connected ? 'gr-dot gr-dot-live' : 'gr-dot'} aria-hidden />
          {title}
        </span>
        <span className="gr-bar-count">
          {remaining !== null ? t('sharedRemaining', { count: remaining, limit }) : t('sharedTagline')}
        </span>
      </div>

      <div className="gr-bar-row">
        <ul className="gr-people" aria-label={t('peopleHere', { count: participants.length })}>
          {participants.map((p) => (
            <li key={`${p.name}-${p.joinedAt}`} className="gr-person" title={p.isHost ? t('hostOf', { name: p.name }) : p.name}>
              <span className="gr-avatar" aria-hidden>{(p.name.trim()[0] ?? '?').toUpperCase()}</span>
              <span className="gr-person-name">{p.name}{p.isHost ? ` ${t('hostTag')}` : ''}</span>
            </li>
          ))}
        </ul>
        <div className="gr-bar-actions">
          <button type="button" onClick={onToggleMeeting} aria-pressed={meetingOn} className="gr-btn">
            {meetingOn ? t('stopVideo') : t('startVideo')}
          </button>
          <button type="button" onClick={onLeave} className="gr-btn gr-btn-quiet">{t('leave')}</button>
        </div>
      </div>

      <GuestInviteLink code={code} surface={surface} full={full} compact />

      {busyWith && <p className="gr-busy" aria-live="polite">{t('waitingOnBrain', { name: busyWith })}</p>}

      <style>{`
        .gr-bar { flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-elevated); }
        .gr-bar-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        .gr-bar-title { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
        .gr-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); flex-shrink: 0; }
        .gr-dot-live { background: var(--success, #16a34a); }
        .gr-bar-count { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
        .gr-people { display: flex; align-items: center; gap: 6px; margin: 0; padding: 0; list-style: none; flex-wrap: wrap; min-width: 0; }
        .gr-person { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 3px; border-radius: var(--radius-full); background: var(--bg-base); border: 1px solid var(--border-subtle); font-size: 12px; color: var(--text-primary); max-width: 160px; }
        .gr-avatar { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--accent, #3b82f6); color: var(--text-on-accent); font-size: 11px; font-weight: 700; flex-shrink: 0; }
        .gr-person-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .gr-bar-actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .gr-btn { padding: 6px 11px; font-size: 12px; font-weight: 600; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); background: var(--bg-base); color: var(--text-primary); cursor: pointer; min-height: 32px; }
        .gr-btn:disabled { opacity: 0.55; cursor: default; }
        .gr-btn-quiet { background: transparent; color: var(--text-muted); }
        .gr-busy { margin: 0; font-size: 12px; color: var(--text-muted); }
        @media (max-width: 520px) {
          .gr-bar-actions { width: 100%; }
          .gr-bar-actions .gr-btn { flex: 1 1 auto; }
        }
      `}</style>
    </div>
  );
}
