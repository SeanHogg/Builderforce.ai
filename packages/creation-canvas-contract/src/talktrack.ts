/**
 * A NARRATED WALKTHROUGH of a board — what was on screen, what was said over it,
 * and where the interesting parts are.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * The canvas could EDIT a video (`CanvasVideoEditor`) and RENDER one
 * (`canvasVideoRender`), and it could not make one of itself. "Let me walk you
 * through this board" therefore left the product entirely: it happened in a
 * meeting nobody recorded, or in a screen recorder whose output came back as an
 * opaque file with no idea which part of it mattered.
 *
 * ── WHY IT IS A PROJECTION AND NOT A KIND ────────────────────────────────────
 * A talktrack is not a new object kind and not a new table. It is the recording a
 * `video` object already knows how to hold, plus the two things a recorder knows
 * that an imported file cannot: WHEN each sentence was said, and which seconds the
 * narrator (or the transcript) marked as worth returning to.
 *
 * {@link talktrackVideoTimeline} lowers those two facts into the timeline the
 * editor already reads — one clip per chapter, each carrying the chapter's title
 * and its captions. So the recording arrives already chaptered and already
 * captioned, in the editor that already trims, splits, exports and publishes it.
 * Nothing downstream has to learn what a talktrack is.
 *
 * ── WHY THE KEY-MOMENT HEURISTIC IS MOSTLY SILENCE ───────────────────────────
 * The language-neutral signal is the PAUSE. A person walking a board stops talking
 * when they stop and move to the next thing, in every language, and that gap is
 * measured rather than guessed. Opening phrases ("so", "next", "over here") are a
 * genuine second signal but they are English until somebody translates them, so
 * they are a PARAMETER with an empty default: the surface passes the list from its
 * own catalog, and a locale with no list still gets chapters from the pauses
 * instead of getting one chapter the length of the recording.
 */

import {
  CANVAS_VIDEO_TIMELINE_VERSION,
  type CanvasVideoSource,
  type CanvasVideoTimeline,
} from './video';

export const CANVAS_TALKTRACK_VERSION = 1;

/** One thing that was said, and when it was said, relative to the recording's start. */
export interface TalktrackCue {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

/**
 * A second worth returning to.
 *
 * `objectId` is what makes a moment a BOARD moment rather than a video one: when
 * the narrator marks a moment while an object is selected, the moment names that
 * object, and the walkthrough reads as "here is where we talked about the pricing
 * model" instead of "here is 4:12".
 */
export interface TalktrackMoment {
  atSeconds: number;
  title: string;
  objectId?: string;
  /** True when a person marked it; absent when it was derived from the transcript. */
  marked?: boolean;
}

export interface CanvasTalktrack {
  version: typeof CANVAS_TALKTRACK_VERSION;
  /** ISO instant the recording started. Empty when it was never recorded here. */
  recordedAt: string;
  durationSeconds: number;
  cues: TalktrackCue[];
  moments: TalktrackMoment[];
}

export function emptyCanvasTalktrack(recordedAt = ''): CanvasTalktrack {
  return { version: CANVAS_TALKTRACK_VERSION, recordedAt, durationSeconds: 0, cues: [], moments: [] };
}

function finite(value: unknown, fallback: number, minimum = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Reads persisted or model-authored JSON defensively, the way the video timeline does. */
export function canvasTalktrackFrom(value: unknown): CanvasTalktrack {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyCanvasTalktrack();
  const raw = value as Record<string, unknown>;
  const cues = Array.isArray(raw.cues) ? raw.cues.flatMap((entry): TalktrackCue[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const cue = entry as Record<string, unknown>;
    const text = trimmed(cue.text);
    if (!text) return [];
    const startSeconds = finite(cue.startSeconds, 0);
    return [{ startSeconds, endSeconds: Math.max(startSeconds, finite(cue.endSeconds, startSeconds)), text }];
  }).sort((a, b) => a.startSeconds - b.startSeconds) : [];
  const moments = Array.isArray(raw.moments) ? raw.moments.flatMap((entry): TalktrackMoment[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const moment = entry as Record<string, unknown>;
    const title = trimmed(moment.title);
    if (!title) return [];
    const objectId = trimmed(moment.objectId);
    return [{
      atSeconds: finite(moment.atSeconds, 0),
      title,
      ...(objectId ? { objectId } : {}),
      ...(moment.marked === true ? { marked: true } : {}),
    }];
  }).sort((a, b) => a.atSeconds - b.atSeconds) : [];
  return {
    version: CANVAS_TALKTRACK_VERSION,
    recordedAt: trimmed(raw.recordedAt),
    durationSeconds: finite(raw.durationSeconds, cues.reduce((longest, cue) => Math.max(longest, cue.endSeconds), 0)),
    cues,
    moments,
  };
}

/** The whole narration as prose — what Brain reads, and what a search matches. */
export function talktrackTranscript(cues: readonly TalktrackCue[]): string {
  return cues.map((cue) => cue.text).join(' ').replace(/\s+/g, ' ').trim();
}

function vttTime(seconds: number): string {
  const whole = Math.max(0, seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${rest.toFixed(3).padStart(6, '0')}`;
}

/**
 * The narration as WebVTT — the format `<track kind="captions">` and every player
 * already read, so the recording is captioned wherever it is watched rather than
 * only inside our own editor.
 */
export function talktrackWebVtt(cues: readonly TalktrackCue[]): string {
  const blocks = cues
    .filter((cue) => cue.text.trim().length > 0)
    .map((cue) => `${vttTime(cue.startSeconds)} --> ${vttTime(Math.max(cue.endSeconds, cue.startSeconds + 0.5))}\n${cue.text.trim()}`);
  return `${['WEBVTT', '', ...blocks.flatMap((block) => [block, ''])].join('\n').trimEnd()}\n`;
}

export interface TalktrackMomentOptions {
  /**
   * The silence that counts as "and now, over here". Below this a pause is
   * breathing; above it the narrator has moved on.
   */
  gapSeconds?: number;
  /**
   * How close two key moments may be. Without a floor a hesitant speaker gets a
   * chapter every eight seconds, which is the same as having none.
   */
  minSpacingSeconds?: number;
  /**
   * Lower-cased phrases that open a new topic IN THE SPEAKER'S LANGUAGE. Empty by
   * default — see the header: a wrong-language list adds nothing, and a missing one
   * costs only the second signal.
   */
  openers?: readonly string[];
  /** Longest a derived chapter title may be before it is elided. */
  maxTitleChars?: number;
}

/** A cue's opening words, cut at a word boundary — the title of the chapter it opens. */
export function talktrackMomentTitle(body: string, maxChars = 48): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  const cut = flat.slice(0, maxChars);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > maxChars / 2 ? cut.slice(0, boundary) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * The moments the TRANSCRIPT says are interesting.
 *
 * Two signals, in the order they are trusted: a measured pause before the cue, and
 * an opening phrase the caller supplied for this locale. A moment is kept only if
 * it is `minSpacingSeconds` clear of the previous one, so the result is a readable
 * chapter list rather than a per-sentence index.
 *
 * The FIRST cue never yields a moment: every chapter list already starts at zero,
 * so one there would name the opening twice.
 */
export function talktrackKeyMoments(
  cues: readonly TalktrackCue[],
  options: TalktrackMomentOptions = {},
): TalktrackMoment[] {
  const { gapSeconds = 2.5, minSpacingSeconds = 20, openers = [], maxTitleChars = 48 } = options;
  const phrases = openers.map((phrase) => phrase.trim().toLocaleLowerCase()).filter(Boolean);
  const moments: TalktrackMoment[] = [];
  let previousEnd: number | null = null;
  let lastKept = Number.NEGATIVE_INFINITY;
  for (const cue of cues) {
    const body = cue.text.trim();
    if (!body) continue;
    const first = previousEnd === null;
    const gap = first ? 0 : cue.startSeconds - previousEnd!;
    previousEnd = Math.max(cue.endSeconds, cue.startSeconds);
    if (first) { lastKept = cue.startSeconds; continue; }
    const opensTopic = phrases.some((phrase) => body.toLocaleLowerCase().startsWith(phrase));
    if (gap < gapSeconds && !opensTopic) continue;
    if (cue.startSeconds - lastKept < minSpacingSeconds) continue;
    lastKept = cue.startSeconds;
    moments.push({ atSeconds: cue.startSeconds, title: talktrackMomentTitle(body, maxTitleChars) });
  }
  return moments;
}

/**
 * Every moment worth chaptering, marked and derived together.
 *
 * A moment a PERSON marked always survives; a derived one is dropped when it lands
 * within `minSpacingSeconds` of one, because the person's own title is better than
 * the first eight words of a sentence, and two chapters eleven seconds apart are
 * worse than either of them alone.
 */
export function mergeTalktrackMoments(
  marked: readonly TalktrackMoment[],
  derived: readonly TalktrackMoment[],
  minSpacingSeconds = 20,
): TalktrackMoment[] {
  const kept = [...marked].sort((a, b) => a.atSeconds - b.atSeconds);
  for (const moment of [...derived].sort((a, b) => a.atSeconds - b.atSeconds)) {
    if (kept.some((existing) => Math.abs(existing.atSeconds - moment.atSeconds) < minSpacingSeconds)) continue;
    kept.push(moment);
    kept.sort((a, b) => a.atSeconds - b.atSeconds);
  }
  return kept;
}

export interface TalktrackChapter {
  startSeconds: number;
  endSeconds: number;
  title: string;
  /** Everything said inside this chapter, as one caption block. */
  captions: string;
  objectId?: string;
}

/**
 * The walkthrough cut into chapters — what "surfaces key moments" actually means.
 *
 * The first chapter always starts at zero even when the first moment does not, so
 * the opening is never orphaned outside the chapter list. `openingTitle` names it,
 * because "the part before the first thing you marked" needs a word and only the
 * surface has a localized one.
 */
export function talktrackChapters(
  talktrack: CanvasTalktrack,
  durationSeconds: number,
  openingTitle = 'Opening',
): TalktrackChapter[] {
  const total = Math.max(durationSeconds, talktrack.durationSeconds, 0.04);
  const starts = [...talktrack.moments]
    .filter((moment) => moment.atSeconds > 0.5 && moment.atSeconds < total - 0.5)
    .sort((a, b) => a.atSeconds - b.atSeconds);
  const bounds: TalktrackChapter[] = [];
  let cursor = 0;
  let title = openingTitle;
  let objectId: string | undefined;
  for (const moment of starts) {
    bounds.push({ startSeconds: cursor, endSeconds: moment.atSeconds, title, captions: '', ...(objectId ? { objectId } : {}) });
    cursor = moment.atSeconds;
    title = moment.title;
    objectId = moment.objectId;
  }
  bounds.push({ startSeconds: cursor, endSeconds: total, title, captions: '', ...(objectId ? { objectId } : {}) });
  return bounds.map((chapter) => ({
    ...chapter,
    captions: talktrackTranscript(
      talktrack.cues.filter((cue) => cue.startSeconds >= chapter.startSeconds && cue.startSeconds < chapter.endSeconds),
    ),
  }));
}

/**
 * The recording, as the timeline the editor already knows how to open.
 *
 * ONE clip per chapter, laid end to end over the SAME source with `trimStart`
 * tracking the chapter's own offset — so playback is bit-for-bit the recording,
 * and the chapter list is a real structure a person can trim, reorder, re-title
 * and export rather than a sidecar only this feature can read.
 */
export function talktrackVideoTimeline(
  source: CanvasVideoSource,
  talktrack: CanvasTalktrack,
  options: { openingTitle?: string; idFactory?: () => string } = {},
): CanvasVideoTimeline {
  const { openingTitle = 'Opening', idFactory = () => crypto.randomUUID() } = options;
  const chapters = talktrackChapters(talktrack, source.durationSeconds, openingTitle)
    .filter((chapter) => chapter.endSeconds - chapter.startSeconds >= 0.04);
  const sized = source.width && source.height ? { width: source.width, height: source.height } : { width: 1920, height: 1080 };
  return {
    version: CANVAS_VIDEO_TIMELINE_VERSION,
    fps: 30,
    ...sized,
    backgroundColor: '#000000',
    clips: chapters.map((chapter) => ({
      id: idFactory(),
      sourceId: source.id,
      track: 'visual' as const,
      startSeconds: chapter.startSeconds,
      durationSeconds: chapter.endSeconds - chapter.startSeconds,
      trimStartSeconds: chapter.startSeconds,
      volume: 1,
      label: chapter.title,
      chapterTitle: chapter.title,
      ...(chapter.captions ? { captions: chapter.captions } : {}),
    })),
  };
}
