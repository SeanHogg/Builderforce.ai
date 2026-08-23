'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { meetingsApi, type MeetingTranscript } from '@/lib/builderforceApi';
import { MeetingTranscriptList } from './MeetingTranscriptList';

/**
 * A meeting's RECORD — its minutes and its transcript — wherever that record is wanted.
 *
 * ── WHY THIS IS ITS OWN COMPONENT ───────────────────────────────────────────
 * The fetch, the "nobody has summarized this yet" state and the generate button used to
 * live inside `MeetingNotes`, i.e. inside a slide-out panel. That made the record
 * reachable from exactly one surface: the meetings list. A ceremony's record and a
 * board's stand-up card both want the same thing and could not have it without a second
 * copy of the same three states — and a second copy is how one surface ends up offering
 * "Generate minutes" for a meeting the other surface already summarized.
 *
 * So it owns its own data access and decides its own visibility: give it a meeting id
 * and it renders that meeting's record; give it null and it renders nothing. It can be
 * dropped onto any surface with no edits, which is the whole reason it is not a section
 * of the panel it started in.
 *
 * ── THE MARKDOWN IS THE RECORD ──────────────────────────────────────────────
 * The minutes are rendered as the model wrote them, in full, never as a re-layout of a
 * parse of them. `parseMeetingMinutes` exists for the board act that turns the checklist
 * into cards, and re-rendering its output HERE would put a lossy reading of the minutes
 * in front of the person who came to read the minutes. What is shown is the source.
 */
export function MeetingMinutesPanel({
  meetingId, showTranscript = true, onMinutes,
}: {
  /** The meeting whose record to show. Null renders nothing — a ceremony that never
   *  opened a companion meeting has no record, and that is not an error state. */
  meetingId: string | null;
  /** Drop the transcript and show the minutes alone — the compact reading a board card
   *  wants, where a hundred caption lines would bury the card it is drawn on. */
  showTranscript?: boolean;
  /** Told the minutes text whenever it changes, so a host that derives something from it
   *  (a follow-up count, say) never fetches the same meeting a second time. */
  onMinutes?: (summary: string | null) => void;
}) {
  const t = useTranslations('meetings');
  const [data, setData] = useState<MeetingTranscript | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!meetingId) { setData(null); setLoading(false); return; }
    setLoading(true);
    meetingsApi.transcript(meetingId)
      .then((result) => { setData(result); setError(null); onMinutes?.(result.summary); })
      // A meeting with no transcript row yet answers the same as one with an empty
      // transcript, because to the reader they are the same fact: nothing was captured.
      .catch(() => { setData({ segments: [], summary: null, summaryGeneratedAt: null }); onMinutes?.(null); })
      .finally(() => setLoading(false));
  }, [meetingId, onMinutes]);

  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async () => {
    if (!meetingId) return;
    setBusy(true);
    setError(null);
    try {
      await meetingsApi.summarize(meetingId);
      load();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('minutesFailed'));
    } finally {
      setBusy(false);
    }
  }, [meetingId, load, t]);

  if (!meetingId) return null;
  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>;

  // Offering to generate is only honest when there is something to generate FROM.
  const canGenerate = !!data && !data.summary && data.segments.length > 0;
  const nothingCaptured = !data?.summary && !data?.segments.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {canGenerate && (
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          style={{
            alignSelf: 'flex-start', fontSize: 13, fontWeight: 700, padding: '8px 14px',
            borderRadius: 'var(--radius-md)', cursor: busy ? 'default' : 'pointer',
            background: 'var(--coral-bright)', color: 'var(--bg-deep)', border: 'none',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? t('generatingMinutes') : t('generateMinutes')}
        </button>
      )}
      {error && <div style={{ fontSize: 12, color: 'var(--error-text)' }}>{error}</div>}
      {nothingCaptured
        ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noMinutesYet')}</div>
        : (
          <MeetingTranscriptList
            segments={showTranscript ? (data?.segments ?? []) : []}
            summary={data?.summary ?? null}
            showTranscript={showTranscript}
          />
        )}
    </div>
  );
}
