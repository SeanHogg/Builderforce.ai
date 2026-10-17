import { describe, expect, it } from 'vitest';
import type { MeetingTranscript, MeetingTranscriptSegment } from '@/lib/builderforceApi';
import { mergeTranscriptTail, transcriptCursor } from './useMeetingTranscript';

const line = (id: string, atMs: number): MeetingTranscriptSegment => ({
  id, atMs, speakerRef: 'u1', speakerName: 'Sean', speakerKind: 'human', text: id, createdAt: `2026-10-17T00:00:00.${String(atMs % 1000).padStart(3, '0')}Z`,
});

/** The live panel reads only lines from the newest `atMs` it holds; the API overlaps, the client de-duplicates. */
describe('meeting transcript tail', () => {
  it('cursors on the newest atMs held', () => {
    expect(transcriptCursor({ segments: [], summary: null, summaryGeneratedAt: null })).toBe(0);
    expect(transcriptCursor({ segments: [line('a', 100), line('b', 900), line('c', 400)], summary: null, summaryGeneratedAt: null })).toBe(900);
  });

  it('adds only unseen ids, in spoken order, and takes the newer summary', () => {
    const held: MeetingTranscript = { segments: [line('a', 100), line('b', 500)], summary: null, summaryGeneratedAt: null };
    // The overlap re-sends `b`; a racing append (`c`) landed with an earlier atMs than `d`.
    const tail: MeetingTranscript = { segments: [line('b', 500), line('d', 900), line('c', 700)], summary: 'Minutes', summaryGeneratedAt: '2026-10-17T01:00:00.000Z' };
    const merged = mergeTranscriptTail(held, tail);
    expect(merged.segments.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(merged.summary).toBe('Minutes');
  });

  it('keeps the held lines when nothing new arrived', () => {
    const held: MeetingTranscript = { segments: [line('a', 100)], summary: null, summaryGeneratedAt: null };
    expect(mergeTranscriptTail(held, { ...held }).segments).toBe(held.segments);
  });
});
