/**
 * Provider-neutral video authoring state persisted on a Canvas `video` object.
 * Both Brain and the direct-manipulation editor write this shape. Rendered files
 * are derived renditions; this timeline remains the editable source of truth.
 */

export const CANVAS_VIDEO_TIMELINE_VERSION = 1;

export type CanvasVideoSourceKind = 'video' | 'audio' | 'image';
export type CanvasVideoTrackKind = 'visual' | 'music' | 'voiceover' | 'sfx';
export type CanvasVideoCaptureKind = 'import' | 'screen' | 'camera' | 'ai';

export interface CanvasVideoSource {
  id: string;
  kind: CanvasVideoSourceKind;
  captureKind: CanvasVideoCaptureKind;
  url: string;
  fileName: string;
  mimeType: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  storageKey?: string;
}

export interface CanvasVideoClip {
  id: string;
  sourceId: string;
  track: CanvasVideoTrackKind;
  startSeconds: number;
  durationSeconds: number;
  trimStartSeconds: number;
  volume: number;
  label: string;
  captions?: string;
  chapterTitle?: string;
}

export interface CanvasVideoTimeline {
  version: typeof CANVAS_VIDEO_TIMELINE_VERSION;
  fps: number;
  width: number;
  height: number;
  backgroundColor: string;
  clips: CanvasVideoClip[];
}

export function emptyCanvasVideoTimeline(): CanvasVideoTimeline {
  return {
    version: CANVAS_VIDEO_TIMELINE_VERSION,
    fps: 30,
    width: 1920,
    height: 1080,
    backgroundColor: '#000000',
    clips: [],
  };
}

function finite(value: unknown, fallback: number, minimum = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

/** Reads old or AI-authored JSON defensively so an invalid patch cannot break the editor. */
export function canvasVideoTimelineFrom(value: unknown): CanvasVideoTimeline {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyCanvasVideoTimeline();
  const raw = value as Record<string, unknown>;
  const clips = Array.isArray(raw.clips) ? raw.clips.flatMap((entry, index): CanvasVideoClip[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const clip = entry as Record<string, unknown>;
    if (typeof clip.sourceId !== 'string' || !clip.sourceId) return [];
    const track: CanvasVideoTrackKind = ['visual', 'music', 'voiceover', 'sfx'].includes(String(clip.track))
      ? clip.track as CanvasVideoTrackKind : 'visual';
    return [{
      id: typeof clip.id === 'string' && clip.id ? clip.id : `clip-${index}`,
      sourceId: clip.sourceId,
      track,
      startSeconds: finite(clip.startSeconds, 0),
      durationSeconds: finite(clip.durationSeconds, 1, 0.04),
      trimStartSeconds: finite(clip.trimStartSeconds, 0),
      volume: Math.min(2, finite(clip.volume, 1)),
      label: typeof clip.label === 'string' ? clip.label : '',
      ...(typeof clip.captions === 'string' ? { captions: clip.captions } : {}),
      ...(typeof clip.chapterTitle === 'string' ? { chapterTitle: clip.chapterTitle } : {}),
    }];
  }) : [];
  return {
    version: CANVAS_VIDEO_TIMELINE_VERSION,
    fps: Math.round(Math.min(60, finite(raw.fps, 30, 1))),
    width: Math.round(Math.min(7680, finite(raw.width, 1920, 16))),
    height: Math.round(Math.min(4320, finite(raw.height, 1080, 16))),
    backgroundColor: typeof raw.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.backgroundColor) ? raw.backgroundColor : '#000000',
    clips,
  };
}

export function canvasVideoSourcesFrom(value: unknown): CanvasVideoSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): CanvasVideoSource[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const source = entry as Record<string, unknown>;
    if (typeof source.id !== 'string' || typeof source.url !== 'string') return [];
    const kind: CanvasVideoSourceKind = ['video', 'audio', 'image'].includes(String(source.kind)) ? source.kind as CanvasVideoSourceKind : 'video';
    const captureKind: CanvasVideoCaptureKind = ['import', 'screen', 'camera', 'ai'].includes(String(source.captureKind)) ? source.captureKind as CanvasVideoCaptureKind : 'import';
    return [{
      id: source.id,
      kind,
      captureKind,
      url: source.url,
      fileName: typeof source.fileName === 'string' ? source.fileName : 'media',
      mimeType: typeof source.mimeType === 'string' ? source.mimeType : '',
      durationSeconds: finite(source.durationSeconds, kind === 'image' ? 5 : 1, 0.04),
      ...(typeof source.width === 'number' ? { width: source.width } : {}),
      ...(typeof source.height === 'number' ? { height: source.height } : {}),
      ...(typeof source.storageKey === 'string' ? { storageKey: source.storageKey } : {}),
    }];
  });
}

export function canvasVideoDuration(timeline: CanvasVideoTimeline): number {
  return timeline.clips.reduce((duration, clip) => Math.max(duration, clip.startSeconds + clip.durationSeconds), 0);
}

export function appendCanvasVideoSource(
  timeline: CanvasVideoTimeline,
  source: CanvasVideoSource,
  track: CanvasVideoTrackKind = source.kind === 'audio' ? 'music' : 'visual',
): CanvasVideoTimeline {
  const sameTrackEnd = timeline.clips
    .filter((clip) => clip.track === track)
    .reduce((duration, clip) => Math.max(duration, clip.startSeconds + clip.durationSeconds), 0);
  return {
    ...timeline,
    clips: [...timeline.clips, {
      id: crypto.randomUUID(),
      sourceId: source.id,
      track,
      startSeconds: track === 'visual' ? sameTrackEnd : 0,
      durationSeconds: source.durationSeconds,
      trimStartSeconds: 0,
      volume: track === 'music' ? 0.65 : 1,
      label: source.fileName,
    }],
  };
}

export function patchCanvasVideoClip(
  timeline: CanvasVideoTimeline,
  clipId: string,
  patch: Partial<Omit<CanvasVideoClip, 'id' | 'sourceId'>>,
): CanvasVideoTimeline {
  return {
    ...timeline,
    clips: timeline.clips.map((clip) => clip.id === clipId ? {
      ...clip,
      ...patch,
      startSeconds: finite(patch.startSeconds, clip.startSeconds),
      durationSeconds: finite(patch.durationSeconds, clip.durationSeconds, 0.04),
      trimStartSeconds: finite(patch.trimStartSeconds, clip.trimStartSeconds),
      volume: Math.min(2, finite(patch.volume, clip.volume)),
    } : clip),
  };
}

export function removeCanvasVideoClip(timeline: CanvasVideoTimeline, clipId: string): CanvasVideoTimeline {
  return { ...timeline, clips: timeline.clips.filter((clip) => clip.id !== clipId) };
}

/** Split one editable clip at an absolute playhead without changing its media source. */
export function splitCanvasVideoClip(timeline: CanvasVideoTimeline, clipId: string, atSeconds: number, idFactory: () => string = () => crypto.randomUUID()): CanvasVideoTimeline {
  const source = timeline.clips.find((clip) => clip.id === clipId);
  if (!source) return timeline;
  const offset = atSeconds - source.startSeconds;
  if (!Number.isFinite(offset) || offset < 0.04 || offset > source.durationSeconds - 0.04) return timeline;
  const left = { ...source, durationSeconds: offset };
  const right = { ...source, id: idFactory(), startSeconds: atSeconds, durationSeconds: source.durationSeconds - offset, trimStartSeconds: source.trimStartSeconds + offset, label: `${source.label} · 2` };
  return { ...timeline, clips: timeline.clips.flatMap((clip) => clip.id === clipId ? [left, right] : [clip]) };
}

/** Reorder clips inside a track and ripple their start positions sequentially. */
export function moveCanvasVideoClip(timeline: CanvasVideoTimeline, clipId: string, delta: -1 | 1): CanvasVideoTimeline {
  const source = timeline.clips.find((clip) => clip.id === clipId); if (!source) return timeline;
  const trackClips = timeline.clips.filter((clip) => clip.track === source.track).sort((a, b) => a.startSeconds - b.startSeconds);
  const index = trackClips.findIndex((clip) => clip.id === clipId); const destination = index + delta;
  if (index < 0 || destination < 0 || destination >= trackClips.length) return timeline;
  [trackClips[index], trackClips[destination]] = [trackClips[destination]!, trackClips[index]!];
  let cursor = source.track === 'visual' ? 0 : Math.min(...trackClips.map((clip) => clip.startSeconds));
  const rippled = new Map(trackClips.map((clip) => { const next = { ...clip, startSeconds: cursor }; cursor += clip.durationSeconds; return [clip.id, next]; }));
  return { ...timeline, clips: timeline.clips.map((clip) => rippled.get(clip.id) ?? clip) };
}
