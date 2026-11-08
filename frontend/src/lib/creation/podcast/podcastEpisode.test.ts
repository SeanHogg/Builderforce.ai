import { describe, expect, it } from 'vitest';
import { emptyCanvasVideoTimeline, type CanvasVideoSource } from '@builderforce/creation-canvas-contract';
import {
  appendPodcastSegment,
  clockTime,
  movePodcastSegment,
  podcastChapters,
  podcastDuration,
  podcastEpisodeFrom,
  podcastSegments,
  podcastShowFrom,
  podcastShowNotesMarkdown,
  removePodcastSegment,
  setPodcastChapter,
  trimPodcastSegment,
} from './podcastEpisode';

const source = (id: string, seconds: number): CanvasVideoSource => ({ id, kind: 'audio', captureKind: 'import', url: `https://cdn.example/${id}.mp3`, fileName: `${id}.mp3`, mimeType: 'audio/mpeg', durationSeconds: seconds });
const sources = [source('intro', 20), source('main', 600), source('outro', 30)];

function built() {
  let timeline = emptyCanvasVideoTimeline();
  timeline = appendPodcastSegment(timeline, sources[0]!, 'c-intro');
  timeline = appendPodcastSegment(timeline, sources[1]!, 'c-main');
  timeline = appendPodcastSegment(timeline, sources[2]!, 'c-outro');
  return timeline;
}
const order = (timeline: ReturnType<typeof built>) => podcastSegments(timeline, sources).map((segment) => segment.clip.id);

describe('segments', () => {
  it('appends back to back on the voiceover track', () => {
    const timeline = built();
    expect(timeline.clips.map((clip) => [clip.track, clip.startSeconds])).toEqual([['voiceover', 0], ['voiceover', 20], ['voiceover', 620]]);
    expect(podcastDuration(timeline)).toBe(650);
  });

  it('reorders and closes the gaps', () => {
    const timeline = movePodcastSegment(built(), 'c-outro', -1);
    expect(order(timeline)).toEqual(['c-intro', 'c-outro', 'c-main']);
    expect(podcastSegments(timeline, sources).map((segment) => segment.clip.startSeconds)).toEqual([0, 20, 50]);
    expect(movePodcastSegment(timeline, 'c-intro', -1)).toEqual(timeline);
  });

  it('removes a segment and ripples the rest', () => {
    const timeline = removePodcastSegment(built(), 'c-main');
    expect(order(timeline)).toEqual(['c-intro', 'c-outro']);
    expect(podcastDuration(timeline)).toBe(50);
  });

  it('trims inside the recording and re-lays the episode', () => {
    let timeline = trimPodcastSegment(built(), sources, 'c-main', { trimStartSeconds: 10, durationSeconds: 100 });
    expect(podcastSegments(timeline, sources).map((segment) => segment.clip.startSeconds)).toEqual([0, 20, 120]);
    timeline = trimPodcastSegment(timeline, sources, 'c-main', { durationSeconds: 99999 });
    expect(timeline.clips.find((clip) => clip.id === 'c-main')!.durationSeconds).toBe(590);
    timeline = trimPodcastSegment(timeline, sources, 'c-intro', { durationSeconds: 0 });
    expect(timeline.clips.find((clip) => clip.id === 'c-intro')!.durationSeconds).toBe(0.5);
  });

  it('keeps a segment whose source is missing, with a null source', () => {
    const segments = podcastSegments(built(), [sources[0]!]);
    expect(segments.map((segment) => segment.source?.id ?? null)).toEqual(['intro', null, null]);
  });
});

describe('chapters', () => {
  it('derives timestamps from the segments carrying a title and drops cleared ones', () => {
    let timeline = setPodcastChapter(built(), 'c-main', '  The interview ');
    timeline = setPodcastChapter(timeline, 'c-outro', 'Goodbye');
    expect(podcastChapters(timeline)).toEqual([{ startTimeSec: 20, title: 'The interview' }, { startTimeSec: 620, title: 'Goodbye' }]);
    expect(podcastChapters(setPodcastChapter(timeline, 'c-outro', ' '))).toHaveLength(1);
  });

  it('writes show notes with a timestamped chapter list', () => {
    const markdown = podcastShowNotesMarkdown('Ep 1', podcastEpisodeFrom({ description: 'Hello.', showNotes: 'Links below.' }), [{ startTimeSec: 3725, title: 'Q&A' }], 'Chapters');
    expect(markdown).toBe('# Ep 1\n\nHello.\n\n## Chapters\n\n- 1:02:05 Q&A\n\nLinks below.\n');
  });
});

describe('metadata readers', () => {
  it('defaults and clamps what it reads', () => {
    expect(podcastShowFrom(undefined)).toMatchObject({ category: 'Technology', language: 'en-us', explicit: false });
    expect(podcastEpisodeFrom({ season: -3, episodeNumber: 4.9, explicit: 'yes', publishedAt: 'not a date' })).toEqual({
      description: '', showNotes: '', author: '', episodeNumber: 4, explicit: false, audioUrl: '',
    });
  });

  it('formats clock times', () => {
    expect(clockTime(65)).toBe('1:05');
    expect(clockTime(3725)).toBe('1:02:05');
    expect(clockTime(65, true)).toBe('0:01:05');
  });
});
