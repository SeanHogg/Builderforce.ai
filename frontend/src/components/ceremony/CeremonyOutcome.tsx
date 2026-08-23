'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MeetingMinutesPanel } from '@/components/meetings/MeetingMinutesPanel';
import { ceremonySessionsApi, type CeremonySession } from '@/lib/builderforceApi';

/**
 * WHAT A CEREMONY PRODUCED — its attendance, what it changed, and its minutes.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * A ceremony's OUTPUT was split across two surfaces that could not see each other. The
 * history panel held attendance and the journal; the companion meeting held the minutes
 * and the transcript; and the board card that STARTED the stand-up held neither — it
 * kept showing the sentence it was stamped with before anyone spoke ("Brain will ask
 * each person for progress, blockers and next actions"), which stayed on the card after
 * the meeting had happened and said what was going to happen rather than what did.
 *
 * So the outcome is a component, and every surface that wants it mounts the same one.
 *
 * ── DERIVED, NEVER STORED ───────────────────────────────────────────────────
 * Nothing here is copied onto the card it is drawn on. The counters live on the ceremony
 * row and the minutes live on the meeting, and a card holding its own copy of either is
 * a card that can contradict them — attendance corrected afterwards is exactly the case
 * that would drift, and the correction is the whole reason the verdict is correctable.
 * Read it live, show what is there, and show nothing when there is nothing yet.
 */
export function CeremonyOutcome({
  ceremonyId, showTranscript = true,
}: {
  /** The ceremony to report on. */
  ceremonyId: string;
  /** Passed through — a board card shows the conclusion, not the conversation. */
  showTranscript?: boolean;
}) {
  const t = useTranslations('ceremonyHistory');
  const [session, setSession] = useState<CeremonySession | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let live = true;
    setState('loading');
    ceremonySessionsApi.detail(ceremonyId)
      .then((detail) => { if (!live) return; setSession(detail.session); setState('ready'); })
      .catch(() => { if (live) setState('failed'); });
    return () => { live = false; };
  }, [ceremonyId]);

  if (state === 'loading') return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('loading')}</div>;
  // A ceremony that cannot be read is reported as such rather than as an empty outcome:
  // "nothing came of the stand-up" and "we could not reach the record" are not the same
  // sentence, and only one of them is the team's fault.
  if (state === 'failed') return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('errorLoad')}</div>;
  if (!session) return null;
  // A session still running has no outcome yet. Its own live surface is the round table.
  if (session.status === 'active') return null;

  const expected = session.humansExpected ?? 0;
  const present = session.humansPresent ?? 0;
  const missed = Math.max(0, expected - present);
  const facts = [
    expected > 0 ? t('attended', { present, expected }) : null,
    missed > 0 ? t('missed', { count: missed }) : null,
    session.reassignedCount ? t('reassigned', { count: session.reassignedCount }) : null,
    session.dispatchedCount ? t('dispatched', { count: session.dispatchedCount }) : null,
    session.closeReason ? t(`closeReason.${session.closeReason}`) : null,
  ].filter((fact): fact is string => !!fact);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {facts.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {facts.map((fact) => (
            <span
              key={fact}
              style={{
                padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: 11, fontWeight: 600,
                border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)', whiteSpace: 'nowrap',
              }}
            >
              {fact}
            </span>
          ))}
        </div>
      )}
      <MeetingMinutesPanel meetingId={session.meetingId ?? null} showTranscript={showTranscript} />
    </div>
  );
}
