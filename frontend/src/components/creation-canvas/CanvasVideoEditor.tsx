'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  appendCanvasVideoSource,
  canvasVideoDuration,
  canvasVideoSourcesFrom,
  canvasVideoTimelineFrom,
  patchCanvasVideoClip,
  removeCanvasVideoClip,
  type CanvasVideoClip,
  type CanvasVideoSource,
  type CanvasVideoTrackKind,
} from '@builderforce/creation-canvas-contract';
import type { CreationNodeData } from './types';
import { storeCanvasMedia } from '@/lib/canvasMediaStore';
import { useCanvasMediaCapture } from '@/hooks/useCanvasMediaCapture';
import { renderCanvasVideo } from '@/lib/canvasVideoRender';
import styles from './CanvasVideoEditor.module.css';

const TRACKS: readonly CanvasVideoTrackKind[] = ['visual', 'music', 'voiceover', 'sfx'];

function time(value: number): string {
  const minutes = Math.floor(value / 60);
  return `${minutes}:${(value % 60).toFixed(1).padStart(4, '0')}`;
}

function PreviewMedia({ clip, source, playhead, playing }: { clip: CanvasVideoClip; source: CanvasVideoSource; playhead: number; playing: boolean }) {
  const media = useRef<HTMLMediaElement | null>(null);
  const desiredTime = clip.trimStartSeconds + Math.max(0, playhead - clip.startSeconds);
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    if (Math.abs(element.currentTime - desiredTime) > 0.35) element.currentTime = desiredTime;
    if (playing) void element.play().catch(() => undefined); else element.pause();
  }, [desiredTime, playing]);
  if (source.kind === 'image') return <img src={source.url} alt={clip.label} />;
  if (source.kind === 'audio') return <audio ref={(node) => { media.current = node; }} src={source.url} preload="auto" />;
  return <video ref={(node) => { media.current = node; }} src={source.url} muted={clip.track === 'visual'} playsInline preload="auto" />;
}

export function CanvasVideoEditor({ data, onEdit }: { data: CreationNodeData; onEdit?: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas.videoEditor');
  const timeline = useMemo(() => canvasVideoTimelineFrom(data.videoTimeline), [data.videoTimeline]);
  const sources = useMemo(() => canvasVideoSourcesFrom(data.videoSources), [data.videoSources]);
  const sourcesById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const duration = Math.max(0.1, canvasVideoDuration(timeline));
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const capture = useCanvasMediaCapture();

  useEffect(() => {
    if (!playing) return;
    const started = performance.now() - playhead * 1000;
    const timer = window.setInterval(() => {
      const next = (performance.now() - started) / 1000;
      if (next >= duration) { setPlayhead(duration); setPlaying(false); } else setPlayhead(next);
    }, 50);
    return () => window.clearInterval(timer);
  }, [duration, playhead, playing]);

  const stop = (event: MouseEvent) => event.stopPropagation();
  const commit = (nextTimeline = timeline, nextSources = sources, extra: Partial<CreationNodeData> = {}) => onEdit?.({
    videoTimeline: nextTimeline,
    videoSources: nextSources,
    duration: canvasVideoDuration(nextTimeline),
    status: nextTimeline.clips.length ? t('editable') : t('draft'),
    ...extra,
  });

  const addFile = async (file: File, track?: CanvasVideoTrackKind, captureKind: 'import' | 'screen' | 'camera' = 'import') => {
    setBusy(t('storingMedia'));
    try {
      const source = await storeCanvasMedia(file, captureKind);
      const resolvedTrack = track ?? (source.kind === 'audio' ? 'music' : 'visual');
      commit(appendCanvasVideoSource(timeline, source, resolvedTrack), [...sources, source]);
    } finally {
      setBusy(null);
    }
  };

  const picked = (track?: CanvasVideoTrackKind) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void addFile(file, track);
  };

  const finishCapture = async () => {
    const mode = capture.mode;
    setBusy(t('finishingCapture'));
    const file = await capture.stop();
    if (file && mode) await addFile(file, 'visual', mode);
    setBusy(null);
  };

  const exportVideo = async () => {
    setBusy(t('rendering'));
    setPlaying(false);
    setRenderProgress(0);
    try {
      const blob = await renderCanvasVideo(timeline, sources, setRenderProgress);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${data.title || 'video'}.webm`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      commit(timeline, sources, { renderedVideoMimeType: blob.type, status: t('exported') });
    } finally {
      setBusy(null);
    }
  };

  const activeClips = timeline.clips.filter((clip) => playhead >= clip.startSeconds && playhead < clip.startSeconds + clip.durationSeconds);
  return <div className={`${styles.editor} nodrag nowheel`} onClick={stop}>
    <div className={styles.preview} style={{ backgroundColor: timeline.backgroundColor }}>
      {activeClips.length === 0 && <span>{t('emptyPreview')}</span>}
      {activeClips.map((clip) => {
        const source = sourcesById.get(clip.sourceId);
        return source ? <PreviewMedia key={clip.id} clip={clip} source={source} playhead={playhead} playing={playing} /> : null;
      })}
      <div className={styles.transport}>
        <button type="button" disabled={!timeline.clips.length} onClick={() => { if (playhead >= duration) setPlayhead(0); setPlaying((value) => !value); }}>{playing ? t('pause') : t('play')}</button>
        <input aria-label={t('playhead')} type="range" min="0" max={duration} step="0.05" value={Math.min(playhead, duration)} onChange={(event) => { setPlaying(false); setPlayhead(Number(event.target.value)); }} />
        <time>{time(playhead)} / {time(duration)}</time>
      </div>
    </div>

    <div className={styles.captureBar}>
      <label>{t('importMedia')}<input type="file" accept="video/*,image/*" onChange={picked('visual')} /></label>
      <label>{t('addMusic')}<input type="file" accept="audio/*" onChange={picked('music')} /></label>
      {!capture.mode && <button type="button" disabled={!capture.isSupported || !!busy} onClick={() => void capture.start('screen')}>{t('recordScreen')}</button>}
      {!capture.mode && <button type="button" disabled={!capture.isSupported || !!busy} onClick={() => void capture.start('camera')}>{t('recordCamera')}</button>}
      {capture.mode && <button type="button" className={styles.recording} onClick={() => void finishCapture()}>{t('stopRecording', { seconds: Math.round(capture.durationMs / 1000) })}</button>}
      <button type="button" disabled={!timeline.clips.length || !!busy} onClick={() => void exportVideo()}>{t('exportVideo')}</button>
    </div>
    {capture.error && capture.error !== 'cancelled' && <p role="alert" className={styles.status}>{t(capture.error === 'unsupported' ? 'captureUnsupported' : 'captureFailed')}</p>}
    {busy && <p role="status" className={styles.status}>{busy}{busy === t('rendering') ? ` · ${Math.round(renderProgress * 100)}%` : ''}</p>}

    <div className={styles.timeline} aria-label={t('timeline')}>
      {TRACKS.map((track) => <section key={track}>
        <header><strong>{t(`track_${track}`)}</strong><span>{timeline.clips.filter((clip) => clip.track === track).length}</span></header>
        <div>
          {timeline.clips.filter((clip) => clip.track === track).map((clip) => <article key={clip.id} className={styles.clip}>
            <b title={clip.label}>{clip.label}</b>
            <label>{t('start')}<input type="number" min="0" step="0.1" value={clip.startSeconds} onChange={(event) => commit(patchCanvasVideoClip(timeline, clip.id, { startSeconds: Number(event.target.value) }))} /></label>
            <label>{t('length')}<input type="number" min="0.1" step="0.1" value={clip.durationSeconds} onChange={(event) => commit(patchCanvasVideoClip(timeline, clip.id, { durationSeconds: Number(event.target.value) }))} /></label>
            <label>{t('trim')}<input type="number" min="0" step="0.1" value={clip.trimStartSeconds} onChange={(event) => commit(patchCanvasVideoClip(timeline, clip.id, { trimStartSeconds: Number(event.target.value) }))} /></label>
            {track !== 'visual' && <label>{t('volume')}<input type="range" min="0" max="2" step="0.05" value={clip.volume} onChange={(event) => commit(patchCanvasVideoClip(timeline, clip.id, { volume: Number(event.target.value) }))} /></label>}
            <button type="button" aria-label={t('removeClip', { name: clip.label })} onClick={() => commit(removeCanvasVideoClip(timeline, clip.id))}>×</button>
          </article>)}
          {!timeline.clips.some((clip) => clip.track === track) && <span className={styles.emptyTrack}>{t('emptyTrack')}</span>}
        </div>
      </section>)}
    </div>
  </div>;
}

