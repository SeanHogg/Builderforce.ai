import { describe, expect, it } from 'vitest';
import {
  canvasTalktrackFrom,
  emptyCanvasTalktrack,
  mergeTalktrackMoments,
  talktrackChapters,
  talktrackKeyMoments,
  talktrackMomentTitle,
  talktrackTranscript,
  talktrackVideoTimeline,
  talktrackWebVtt,
  type CanvasTalktrack,
  type CanvasVideoSource,
  type TalktrackCue,
} from '@builderforce/creation-canvas-contract';

const recording: CanvasVideoSource = {
  id: 'source-walkthrough',
  kind: 'video',
  captureKind: 'screen',
  url: '/walkthrough.webm',
  fileName: 'walkthrough.webm',
  mimeType: 'video/webm',
  durationSeconds: 120,
  width: 1280,
  height: 720,
};

/** A narration with two real pauses in it, at 40s and at 82s. */
const cues: TalktrackCue[] = [
  { startSeconds: 0, endSeconds: 6, text: 'This board is the pricing model.' },
  { startSeconds: 6, endSeconds: 12, text: 'The three tiers are on the left.' },
  { startSeconds: 40, endSeconds: 47, text: 'Now the churn assumption, which is the one everybody argues about.' },
  { startSeconds: 47, endSeconds: 52, text: 'It is six percent.' },
  { startSeconds: 82, endSeconds: 90, text: 'Finally the sensitivity table.' },
];

const track = (patch: Partial<CanvasTalktrack> = {}): CanvasTalktrack => ({
  ...emptyCanvasTalktrack('2026-08-23T10:00:00.000Z'),
  durationSeconds: 120,
  cues,
  ...patch,
});

describe('talktrack key moments', () => {
  /**
   * THE ONE THIS FILE EXISTS FOR. The pause is the language-neutral signal: a
   * person walking a board stops talking when they stop and move on. Two pauses in
   * this narration, so two chapter breaks — not five, one per sentence.
   */
  it('finds a moment at each real pause and nowhere else', () => {
    expect(talktrackKeyMoments(cues).map((moment) => moment.atSeconds)).toEqual([40, 82]);
  });

  /** The first cue is the opening, and the chapter list already starts at zero —
   *  emitting a moment there would name the opening twice. */
  it('never emits a moment for the first cue', () => {
    expect(talktrackKeyMoments([{ startSeconds: 0, endSeconds: 4, text: 'Here we go.' }])).toEqual([]);
  });

  /**
   * A hesitant speaker pauses constantly. Without a floor that is a chapter every
   * few seconds, which is the same as having no chapters at all.
   *
   * The floor is measured from the last chapter boundary that was KEPT — including
   * the opening at zero — not from the last candidate considered. Measuring from
   * the candidate would let a run of rejected pauses walk the boundary forward a
   * few seconds at a time and admit one anyway.
   */
  it('refuses a moment inside the spacing floor, measured from the last kept boundary', () => {
    const stuttered: TalktrackCue[] = [
      { startSeconds: 0, endSeconds: 2, text: 'Right.' },
      { startSeconds: 8, endSeconds: 10, text: 'So this bit.' },
      { startSeconds: 16, endSeconds: 18, text: 'And this bit.' },
      { startSeconds: 24, endSeconds: 26, text: 'And this one.' },
    ];
    // 8 and 16 are both a clear 20s of the opening; only 24 is.
    expect(talktrackKeyMoments(stuttered, { gapSeconds: 2 }).map((m) => m.atSeconds)).toEqual([24]);
    expect(talktrackKeyMoments(stuttered, { gapSeconds: 2, minSpacingSeconds: 4 }).map((m) => m.atSeconds))
      .toEqual([8, 16, 24]);
  });

  /**
   * The second signal is a topic OPENER, and it is a parameter because it is
   * language-specific. With no list a locale still gets the pauses; with one it
   * also gets the breaks a speaker made without pausing.
   */
  it('takes an opening phrase as a second signal, in the caller’s language', () => {
    const continuous: TalktrackCue[] = [
      { startSeconds: 0, endSeconds: 25, text: 'The revenue build is here.' },
      { startSeconds: 25, endSeconds: 60, text: 'Ensuite les hypothèses de coût.' },
    ];
    // No pause between them at all, so the language-neutral signal finds nothing…
    expect(talktrackKeyMoments(continuous)).toEqual([]);
    // …and the phrase the speaker actually used finds the break.
    expect(talktrackKeyMoments(continuous, { openers: ['ensuite'] }).map((m) => m.atSeconds)).toEqual([25]);
  });

  it('cuts a long opening line into a title at a word boundary', () => {
    expect(talktrackMomentTitle('short line')).toBe('short line');
    const long = talktrackMomentTitle('Now the churn assumption, which is the one everybody argues about.');
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(49);
    expect(long.startsWith('Now the churn assumption')).toBe(true);
  });

  /** A person's own title beats the first eight words of a sentence, and two
   *  chapters eleven seconds apart are worse than either alone. */
  it('keeps a marked moment and drops the derived one beside it', () => {
    const merged = mergeTalktrackMoments(
      [{ atSeconds: 42, title: 'Churn', marked: true }],
      [{ atSeconds: 40, title: 'Now the churn assumption…' }, { atSeconds: 82, title: 'Finally the sensitivity table.' }],
    );
    expect(merged.map((moment) => moment.title)).toEqual(['Churn', 'Finally the sensitivity table.']);
  });
});

describe('talktrack chapters', () => {
  it('always opens at zero, even when the first moment does not', () => {
    const chapters = talktrackChapters(track({ moments: talktrackKeyMoments(cues) }), 120, 'Opening');
    expect(chapters.map((chapter) => [chapter.startSeconds, chapter.endSeconds, chapter.title])).toEqual([
      [0, 40, 'Opening'],
      [40, 82, 'Now the churn assumption, which is the one…'],
      [82, 120, 'Finally the sensitivity table.'],
    ]);
  });

  it('gives each chapter only the narration said inside it', () => {
    const chapters = talktrackChapters(track({ moments: talktrackKeyMoments(cues) }), 120);
    expect(chapters[0]!.captions).toBe('This board is the pricing model. The three tiers are on the left.');
    expect(chapters[2]!.captions).toBe('Finally the sensitivity table.');
  });

  /** A moment carries the object it was marked on, so a chapter can say what it is
   *  about rather than only when it is. */
  it('carries a marked moment’s board object onto its chapter', () => {
    const chapters = talktrackChapters(track({ moments: [{ atSeconds: 30, title: 'Pricing card', objectId: 'node-7', marked: true }] }), 120);
    expect(chapters[1]!.objectId).toBe('node-7');
    expect(chapters[0]!.objectId).toBeUndefined();
  });

  it('is one chapter when nothing was marked and nobody paused', () => {
    expect(talktrackChapters(track({ cues: [], moments: [] }), 60)).toHaveLength(1);
  });
});

describe('the recording as a video timeline', () => {
  /**
   * THE BRIDGE. The walkthrough has to arrive in the editor that already trims,
   * splits, captions, exports and publishes — so a chapter is a CLIP over the same
   * source, laid end to end, with `trimStart` tracking its own offset. Playback is
   * then bit-for-bit the recording and the chapters are real, editable structure.
   */
  it('lays one clip per chapter end to end over the same source', () => {
    let n = 0;
    const timeline = talktrackVideoTimeline(recording, track({ moments: talktrackKeyMoments(cues) }), {
      idFactory: () => `clip-${(n += 1)}`,
    });
    expect(timeline.clips).toHaveLength(3);
    expect(timeline.clips.every((clip) => clip.sourceId === recording.id)).toBe(true);
    // Contiguous, and each clip reads from its own offset — nothing is repeated and
    // nothing is skipped.
    expect(timeline.clips.map((clip) => [clip.startSeconds, clip.durationSeconds, clip.trimStartSeconds])).toEqual([
      [0, 40, 0],
      [40, 42, 40],
      [82, 38, 82],
    ]);
    expect(timeline.clips.map((clip) => clip.chapterTitle)).toEqual([
      'Opening',
      'Now the churn assumption, which is the one…',
      'Finally the sensitivity table.',
    ]);
    expect(timeline.clips[0]!.captions).toContain('This board is the pricing model.');
    // The recording's own frame, not a 1080p default it never had.
    expect([timeline.width, timeline.height]).toEqual([1280, 720]);
  });

  it('is a single clip for a walkthrough with no chapters', () => {
    const timeline = talktrackVideoTimeline(recording, track({ cues: [], moments: [] }));
    expect(timeline.clips).toHaveLength(1);
    expect(timeline.clips[0]!.durationSeconds).toBe(120);
  });
});

describe('talktrack transport shapes', () => {
  it('reads a persisted talktrack defensively and drops what it cannot use', () => {
    const parsed = canvasTalktrackFrom({
      version: 99,
      recordedAt: '2026-08-23T10:00:00.000Z',
      cues: [
        { startSeconds: 12, endSeconds: 14, text: 'second' },
        { startSeconds: 'nonsense', endSeconds: 4, text: 'first' },
        { startSeconds: 20, text: '   ' },
        'not a cue',
      ],
      moments: [{ atSeconds: 9, title: 'Kept' }, { atSeconds: 3, title: '' }],
    });
    expect(parsed.version).toBe(1);
    expect(parsed.cues.map((cue) => cue.text)).toEqual(['first', 'second']);
    expect(parsed.moments.map((moment) => moment.title)).toEqual(['Kept']);
    // Derived from the cues rather than trusted from a field that was not sent.
    expect(parsed.durationSeconds).toBe(14);
  });

  it('is empty rather than broken for junk', () => {
    expect(canvasTalktrackFrom(null).cues).toEqual([]);
    expect(canvasTalktrackFrom('a talktrack').moments).toEqual([]);
    expect(canvasTalktrackFrom([]).durationSeconds).toBe(0);
  });

  it('flattens the narration to prose for Brain and for search', () => {
    expect(talktrackTranscript(cues)).toContain('This board is the pricing model. The three tiers are on the left.');
  });

  /** WebVTT is what a player OUTSIDE our editor reads, so the timing has to be the
   *  format's own — `HH:MM:SS.mmm`, not seconds. */
  it('writes captions any player can read', () => {
    const vtt = talktrackWebVtt([{ startSeconds: 61.5, endSeconds: 64, text: 'Over here.' }]);
    expect(vtt.startsWith('WEBVTT\n')).toBe(true);
    expect(vtt).toContain('00:01:01.500 --> 00:01:04.000');
    expect(vtt).toContain('Over here.');
  });

  /** A cue the transcriber finalized with no measurable length would be a zero-width
   *  caption no player shows. */
  it('gives a zero-length cue a floor so it is actually displayed', () => {
    expect(talktrackWebVtt([{ startSeconds: 3, endSeconds: 3, text: 'Right.' }]))
      .toContain('00:00:03.000 --> 00:00:03.500');
  });
});
