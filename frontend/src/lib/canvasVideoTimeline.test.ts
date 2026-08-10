import { describe, expect, it } from 'vitest';
import {
  appendCanvasVideoSource,
  canvasVideoDuration,
  canvasVideoSourcesFrom,
  canvasVideoTimelineFrom,
  emptyCanvasVideoTimeline,
  patchCanvasVideoClip,
  removeCanvasVideoClip,
  type CanvasVideoSource,
} from '@builderforce/creation-canvas-contract';

const video: CanvasVideoSource = {
  id: 'source-video', kind: 'video', captureKind: 'screen', url: '/screen.webm',
  fileName: 'screen.webm', mimeType: 'video/webm', durationSeconds: 8,
};
const music: CanvasVideoSource = {
  id: 'source-music', kind: 'audio', captureKind: 'import', url: '/music.mp3',
  fileName: 'music.mp3', mimeType: 'audio/mpeg', durationSeconds: 12,
};

describe('Canvas video timeline', () => {
  it('places visual shots sequentially and overlays music from zero', () => {
    let timeline = appendCanvasVideoSource(emptyCanvasVideoTimeline(), video, 'visual');
    timeline = appendCanvasVideoSource(timeline, { ...video, id: 'source-two', fileName: 'camera.webm', durationSeconds: 4 }, 'visual');
    timeline = appendCanvasVideoSource(timeline, music, 'music');
    expect(timeline.clips.map((clip) => ({ track: clip.track, start: clip.startSeconds }))).toEqual([
      { track: 'visual', start: 0 },
      { track: 'visual', start: 8 },
      { track: 'music', start: 0 },
    ]);
    expect(canvasVideoDuration(timeline)).toBe(12);
  });

  it('bounds AI-authored values and drops malformed clips and sources', () => {
    expect(canvasVideoTimelineFrom({ fps: 500, width: -4, backgroundColor: 'red', clips: [
      { sourceId: 'ok', durationSeconds: -3, volume: 99 },
      { durationSeconds: 4 },
    ] })).toMatchObject({ fps: 60, width: 16, backgroundColor: '#000000', clips: [{ sourceId: 'ok', durationSeconds: 0.04, volume: 2 }] });
    expect(canvasVideoSourcesFrom([{ id: 'one', url: '/one', kind: 'nonsense', durationSeconds: 0 }, { url: '/missing-id' }]))
      .toEqual([expect.objectContaining({ id: 'one', kind: 'video', durationSeconds: 0.04 })]);
  });

  it('edits and removes a clip without replacing the video object', () => {
    const timeline = appendCanvasVideoSource(emptyCanvasVideoTimeline(), video, 'visual');
    const clipId = timeline.clips[0]!.id;
    const edited = patchCanvasVideoClip(timeline, clipId, { startSeconds: 2, durationSeconds: 5, trimStartSeconds: 1 });
    expect(edited.clips[0]).toMatchObject({ id: clipId, sourceId: video.id, startSeconds: 2, durationSeconds: 5, trimStartSeconds: 1 });
    expect(removeCanvasVideoClip(edited, clipId).clips).toEqual([]);
  });
});
