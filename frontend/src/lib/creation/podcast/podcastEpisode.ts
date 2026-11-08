/**
 * The podcast kind's episode model — pure data and pure edits.
 *
 * ── REUSE, NOT A NEW TIMELINE ────────────────────────────────────────────────
 * An episode is a sequence of audio segments, which is exactly a single track of the
 * `video` kind's timeline: a clip references a source, has a start, a duration and a
 * trim, and may carry a `chapterTitle`. So the episode stores `podcastTimeline`
 * (a `CanvasVideoTimeline` whose clips all sit on the `voiceover` track) and
 * `podcastSources` (`CanvasVideoSource[]`, the same shape the video editor and
 * `storeCanvasMedia` produce). The contract's own clip operations do the editing; this
 * module only adds what a podcast needs on top — sequential layout (no gaps, no
 * overlaps), source-bounded trimming and chapter extraction.
 *
 * What is NOT here: a mixed-down audio file. There is no in-browser audio mixer, so the
 * RSS enclosure points at a published master (`audioUrl`), or at the lone segment when
 * the episode is a single recording. `podcastRss.ts` refuses to emit a feed otherwise.
 */
import {
  canvasVideoDuration,
  canvasVideoSourcesFrom,
  canvasVideoTimelineFrom,
  moveCanvasVideoClip,
  patchCanvasVideoClip,
  removeCanvasVideoClip,
  type CanvasVideoClip,
  type CanvasVideoSource,
  type CanvasVideoTimeline,
} from '@builderforce/creation-canvas-contract';

export const PODCAST_TRACK = 'voiceover' as const;
const MIN_SEGMENT_SECONDS = 0.5;

export interface PodcastEpisodeMeta {
  description: string;
  /** Long-form notes shown under the player; exported as Markdown. */
  showNotes: string;
  author: string;
  season?: number;
  episodeNumber?: number;
  explicit: boolean;
  /** The published, publicly reachable master file the feed's enclosure points at. */
  audioUrl: string;
  audioBytes?: number;
  /** Stored byte size of each added audio source, by source id: the enclosure `length` of a single-segment episode. */
  sourceBytes?: Record<string, number>;
  /** ISO date; the feed uses the export time while it is empty. */
  publishedAt?: string;
}

export interface PodcastShowMeta {
  title: string;
  description: string;
  link: string;
  imageUrl: string;
  author: string;
  ownerEmail: string;
  category: string;
  language: string;
  explicit: boolean;
  feedUrl: string;
}

export interface PodcastSegment { clip: CanvasVideoClip; source: CanvasVideoSource | null }
export interface PodcastChapter { startTimeSec: number; title: string }

function text(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}
function whole(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export function podcastEpisodeFrom(value: unknown): PodcastEpisodeMeta {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const season = whole(raw.season);
  const episodeNumber = whole(raw.episodeNumber);
  const audioBytes = whole(raw.audioBytes);
  const sourceBytes = Object.fromEntries(
    Object.entries(raw.sourceBytes && typeof raw.sourceBytes === 'object' && !Array.isArray(raw.sourceBytes) ? raw.sourceBytes as Record<string, unknown> : {})
      .flatMap(([id, bytes]) => { const size = whole(bytes); return size !== undefined && size > 0 ? [[id.slice(0, 64), size] as const] : []; })
      .slice(0, 200),
  );
  return {
    description: text(raw.description, 4000),
    showNotes: text(raw.showNotes, 20000),
    author: text(raw.author, 200),
    ...(season !== undefined ? { season } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    explicit: raw.explicit === true,
    audioUrl: text(raw.audioUrl, 2000).trim(),
    ...(audioBytes !== undefined ? { audioBytes } : {}),
    ...(Object.keys(sourceBytes).length ? { sourceBytes } : {}),
    ...(typeof raw.publishedAt === 'string' && !Number.isNaN(Date.parse(raw.publishedAt)) ? { publishedAt: raw.publishedAt } : {}),
  };
}

export function podcastShowFrom(value: unknown): PodcastShowMeta {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  return {
    title: text(raw.title, 200),
    description: text(raw.description, 4000),
    link: text(raw.link, 2000).trim(),
    imageUrl: text(raw.imageUrl, 2000).trim(),
    author: text(raw.author, 200),
    ownerEmail: text(raw.ownerEmail, 320).trim(),
    category: text(raw.category, 100) || 'Technology',
    language: text(raw.language, 20) || 'en-us',
    explicit: raw.explicit === true,
    feedUrl: text(raw.feedUrl, 2000).trim(),
  };
}

/** Segments in play order, each beside the source it references (null when the source is gone). */
export function podcastSegments(timeline: CanvasVideoTimeline, sources: readonly CanvasVideoSource[]): PodcastSegment[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return timeline.clips
    .filter((clip) => clip.track === PODCAST_TRACK)
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .map((clip) => ({ clip, source: byId.get(clip.sourceId) ?? null }));
}

/**
 * The byte size of the audio file the feed's enclosure will point at, when the episode
 * records it: that of the lone segment's source. Undefined when a hand-typed master URL
 * is the enclosure (its size is `audioBytes`, entered or measured) or when nothing was recorded.
 */
export function podcastEnclosureBytes(data: Readonly<Record<string, unknown>>): number | undefined {
  const episode = podcastEpisodeFrom(data.podcastEpisode);
  if (/^https?:\/\//i.test(episode.audioUrl)) return undefined;
  const { timeline, sources } = podcastStateFrom(data);
  const segments = podcastSegments(timeline, sources);
  const lone = segments.length === 1 ? segments[0]!.source : null;
  return lone ? episode.sourceBytes?.[lone.id] : undefined;
}

/** Read what is stored on the object into the two structures the editor edits. */
export function podcastStateFrom(data: Readonly<Record<string, unknown>>): { timeline: CanvasVideoTimeline; sources: CanvasVideoSource[] } {
  return { timeline: canvasVideoTimelineFrom(data.podcastTimeline), sources: canvasVideoSourcesFrom(data.podcastSources) };
}

/** Close every gap and overlap: segments run back to back in their current order. */
export function layoutPodcast(timeline: CanvasVideoTimeline): CanvasVideoTimeline {
  const ordered = timeline.clips.filter((clip) => clip.track === PODCAST_TRACK).sort((a, b) => a.startSeconds - b.startSeconds);
  let cursor = 0;
  const starts = new Map(ordered.map((clip) => { const start = cursor; cursor += clip.durationSeconds; return [clip.id, start]; }));
  return { ...timeline, clips: timeline.clips.map((clip) => starts.has(clip.id) ? { ...clip, startSeconds: starts.get(clip.id)! } : clip) };
}

export function appendPodcastSegment(timeline: CanvasVideoTimeline, source: CanvasVideoSource, id: string = crypto.randomUUID()): CanvasVideoTimeline {
  const end = canvasVideoDuration({ ...timeline, clips: timeline.clips.filter((clip) => clip.track === PODCAST_TRACK) });
  return {
    ...timeline,
    clips: [...timeline.clips, {
      id, sourceId: source.id, track: PODCAST_TRACK, startSeconds: end, durationSeconds: Math.max(MIN_SEGMENT_SECONDS, source.durationSeconds),
      trimStartSeconds: 0, volume: 1, label: source.fileName.replace(/\.[^.]+$/, ''),
    }],
  };
}

export function movePodcastSegment(timeline: CanvasVideoTimeline, clipId: string, delta: -1 | 1): CanvasVideoTimeline {
  return layoutPodcast(moveCanvasVideoClip(timeline, clipId, delta));
}

export function removePodcastSegment(timeline: CanvasVideoTimeline, clipId: string): CanvasVideoTimeline {
  return layoutPodcast(removeCanvasVideoClip(timeline, clipId));
}

/**
 * Trim a segment to `[trimStart, trimStart + duration]` of its source.
 * Clamped so the window stays inside the recording and keeps a minimum length.
 */
export function trimPodcastSegment(
  timeline: CanvasVideoTimeline,
  sources: readonly CanvasVideoSource[],
  clipId: string,
  patch: { trimStartSeconds?: number; durationSeconds?: number },
): CanvasVideoTimeline {
  const clip = timeline.clips.find((entry) => entry.id === clipId);
  if (!clip) return timeline;
  const total = sources.find((source) => source.id === clip.sourceId)?.durationSeconds ?? clip.trimStartSeconds + clip.durationSeconds;
  const trimStart = Math.min(Math.max(0, patch.trimStartSeconds ?? clip.trimStartSeconds), Math.max(0, total - MIN_SEGMENT_SECONDS));
  const duration = Math.min(Math.max(MIN_SEGMENT_SECONDS, patch.durationSeconds ?? clip.durationSeconds), Math.max(MIN_SEGMENT_SECONDS, total - trimStart));
  return layoutPodcast(patchCanvasVideoClip(timeline, clipId, { trimStartSeconds: trimStart, durationSeconds: duration }));
}

export function renamePodcastSegment(timeline: CanvasVideoTimeline, clipId: string, label: string): CanvasVideoTimeline {
  return patchCanvasVideoClip(timeline, clipId, { label: label.slice(0, 200) });
}

/** A chapter marks the start of the segment that carries its title; an empty title removes it. */
export function setPodcastChapter(timeline: CanvasVideoTimeline, clipId: string, title: string): CanvasVideoTimeline {
  const clean = title.trim().slice(0, 200);
  return {
    ...timeline,
    clips: timeline.clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      const next: CanvasVideoClip = { ...clip };
      if (clean) next.chapterTitle = clean; else delete next.chapterTitle;
      return next;
    }),
  };
}

export function podcastChapters(timeline: CanvasVideoTimeline): PodcastChapter[] {
  return timeline.clips
    .filter((clip) => clip.track === PODCAST_TRACK && !!clip.chapterTitle?.trim())
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .map((clip) => ({ startTimeSec: Math.round(clip.startSeconds * 10) / 10, title: clip.chapterTitle!.trim() }));
}

export function podcastDuration(timeline: CanvasVideoTimeline): number {
  return canvasVideoDuration({ ...timeline, clips: timeline.clips.filter((clip) => clip.track === PODCAST_TRACK) });
}

/** HH:MM:SS (or M:SS under an hour) — chapter lists and the feed's duration tag. */
export function clockTime(totalSeconds: number, alwaysHours = false): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = String(whole % 60).padStart(2, '0');
  return hours || alwaysHours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** Show notes with a timestamped chapter list, as a Markdown file. */
export function podcastShowNotesMarkdown(title: string, episode: PodcastEpisodeMeta, chapters: readonly PodcastChapter[], chaptersHeading: string): string {
  const lines = [`# ${title}`, ''];
  if (episode.description.trim()) lines.push(episode.description.trim(), '');
  if (chapters.length) lines.push(`## ${chaptersHeading}`, '', ...chapters.map((chapter) => `- ${clockTime(chapter.startTimeSec)} ${chapter.title}`), '');
  if (episode.showNotes.trim()) lines.push(episode.showNotes.trim(), '');
  return lines.join('\n');
}
