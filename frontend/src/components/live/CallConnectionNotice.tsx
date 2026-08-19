// No 'use client' directive: both hosts (`LiveBar`, `GuestRoomMeeting`) are already
// client components, so the boundary is inherited and a second declaration here would
// only add a file to the architecture ratchet's client-component tally.
import { useTranslations } from 'next-intl';
import { useOptionalLiveSession } from '@/lib/live/LiveSessionContext';
import type { MediaRoomConnection } from '@/lib/useMediaRoom';
import styles from './CallConnectionNotice.module.css';

/**
 * The ONE sentence that says why a call is not up.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 * Two surfaces render the same room — the shell dock and the free room's meeting
 * panel — and both printed the word "Connecting" for as long as the socket was
 * not open. That is the same word for the first half-second of a healthy call, for
 * a relay that refused the upgrade, and for a room this browser holds no
 * credential for; it is why "it says connecting and never connects" was a report
 * with nothing behind it. Worse, it was TWO copies of that wording in two
 * namespaces, so improving one would have left the other saying the old thing.
 *
 * So the state comes from the transport (`useMediaRoom`'s `connection`) and the
 * wording lives here, once. Self-gating on the session — a host never passes a
 * `showNotice` it could not compute itself — and silent when the call is up or
 * when there is no call, because both hosts already say THAT in their own chrome
 * (the dock's pulse and roster; the panel's title).
 */
const NOTICE: Partial<Record<MediaRoomConnection, { key: 'connecting' | 'reconnecting' | 'callUnauthenticated'; tone: 'waiting' | 'error' }>> = {
  connecting: { key: 'connecting', tone: 'waiting' },
  retrying: { key: 'reconnecting', tone: 'error' },
  unauthenticated: { key: 'callUnauthenticated', tone: 'error' },
};

export function CallConnectionNotice() {
  const live = useOptionalLiveSession();
  const t = useTranslations('liveBar');
  const notice = live ? NOTICE[live.connection] : undefined;
  if (!notice) return null;
  return (
    <span className={styles.notice} data-tone={notice.tone} role="status">
      {t(notice.key)}
    </span>
  );
}
