/**
 * A meeting's transcript, kept current while the panel is open and the meeting is live.
 *
 * The live panel used to re-read the WHOLE transcript every five seconds. Now the
 * first read is whole and each tick asks only for lines from the newest `atMs` it
 * holds (`?sinceAtMs=`; the API reaches back a few seconds for racing appends) and
 * folds them in by id. The summary rides along on every read, so minutes generated
 * mid-meeting still appear. Polling stops when the meeting ends or the panel closes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePolledResource } from '@/hooks/usePolledResource';
import { meetingsApi, type MeetingTranscript, type MeetingTranscriptSegment } from '@/lib/builderforceApi';

const LIVE_POLL_MS = 5_000;

function spokenOrder(a: MeetingTranscriptSegment, b: MeetingTranscriptSegment): number {
  return a.atMs - b.atMs || a.createdAt.localeCompare(b.createdAt);
}

/** Fold a tail read into the held transcript: new ids added in spoken order, the summary taken from the newer read. */
export function mergeTranscriptTail(held: MeetingTranscript, tail: MeetingTranscript): MeetingTranscript {
  const seen = new Set(held.segments.map((segment) => segment.id));
  const added = tail.segments.filter((segment) => !seen.has(segment.id));
  const segments = added.length ? [...held.segments, ...added].sort(spokenOrder) : held.segments;
  return { segments, summary: tail.summary, summaryGeneratedAt: tail.summaryGeneratedAt };
}

/** The newest `atMs` held — the next read's cursor. */
export function transcriptCursor(transcript: MeetingTranscript): number {
  let max = 0;
  for (const segment of transcript.segments) if (segment.atMs > max) max = segment.atMs;
  return max;
}

export function useMeetingTranscript(meetingId: string, { open, live }: { open: boolean; live: boolean }): { transcript: MeetingTranscript | null; reload: () => void } {
  const [transcript, setTranscript] = useState<MeetingTranscript | null>(null);
  const heldRef = useRef<MeetingTranscript | null>(null);
  const commit = useCallback((next: MeetingTranscript) => { heldRef.current = next; setTranscript(next); }, []);

  // A whole read: on open, and after something that rewrites more than the tail (minutes).
  const reload = useCallback(() => {
    meetingsApi.transcript(meetingId).then(commit).catch(() => { /* ignore */ });
  }, [meetingId, commit]);
  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  usePolledResource(async (signal) => {
    const held = heldRef.current;
    const next = await meetingsApi.transcript(meetingId, held ? transcriptCursor(held) : undefined);
    if (signal.aborted || heldRef.current !== held) return;
    commit(held ? mergeTranscriptTail(held, next) : next);
  }, { intervalMs: LIVE_POLL_MS, enabled: open && live, immediate: false });

  return { transcript, reload };
}
