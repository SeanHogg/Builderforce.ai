'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  appendCanvasVideoSource,
  canvasVideoDuration,
  canvasVideoSourcesFrom,
  canvasVideoTimelineFrom,
  patchCanvasVideoClip,
  moveCanvasVideoClip,
  removeCanvasVideoClip,
  splitCanvasVideoClip,
  type CanvasVideoClip,
  type CanvasVideoSource,
  type CanvasVideoTrackKind,
} from '@builderforce/creation-canvas-contract';
import type { CreationNodeData } from './types';
import { storeCanvasMedia } from '@/lib/canvasMediaStore';
import { useCanvasMediaCapture } from '@/hooks/useCanvasMediaCapture';
import { renderCanvasVideo } from '@/lib/canvasVideoRender';
import { youtubeApi, type YouTubeConnection } from '@/lib/youtubeApi';
import styles from './CanvasVideoEditor.module.css';
import { VIDEO_RESUME_TEMPLATES, videoResumeTemplatePatch, type VideoResumeScene } from '@/lib/videoResumeTemplates';

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
    element.volume = Math.max(0, Math.min(1, clip.volume));
    if (Math.abs(element.currentTime - desiredTime) > 0.35) element.currentTime = desiredTime;
    if (playing) void element.play().catch(() => undefined); else element.pause();
  }, [desiredTime, playing]);
  // Canvas media may be a data URL, a local blob, or an authenticated R2 URL;
  // Next Image cannot optimize those editor-owned sources.
  // eslint-disable-next-line @next/next/no-img-element
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
  const [problem, setProblem] = useState<string | null>(null);
  const [youtubeConnections, setYoutubeConnections] = useState<YouTubeConnection[]>([]);
  const [youtubeConfigured, setYoutubeConfigured] = useState(true);
  const [youtubeConnectionId, setYoutubeConnectionId] = useState<number | null>(null);
  const [youtubeTitle, setYoutubeTitle] = useState(data.title);
  const [youtubeDescription, setYoutubeDescription] = useState('');
  const [youtubePrivacy, setYoutubePrivacy] = useState<'private' | 'unlisted' | 'public'>('unlisted');
  const capture = useCanvasMediaCapture();
  const editable = !!onEdit;
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateProfession, setTemplateProfession] = useState('all');
  const storyboard = Array.isArray(data.videoStoryboard) ? data.videoStoryboard.filter((scene): scene is VideoResumeScene => !!scene && typeof scene === 'object' && !Array.isArray(scene) && typeof (scene as VideoResumeScene).id === 'string') : [];
  const updateStoryboard = (sceneId: string, patch: Partial<VideoResumeScene>) => onEdit?.({ videoStoryboard: storyboard.map((item) => item.id === sceneId ? { ...item, ...patch } : item) });
  const moveStoryboardScene = (sceneId: string, delta: -1 | 1) => {
    const next = [...storyboard]; const index = next.findIndex((scene) => scene.id === sceneId); const destination = index + delta;
    if (index < 0 || destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination]!, next[index]!]; onEdit?.({ videoStoryboard: next });
  };
  const duplicateStoryboardScene = (scene: VideoResumeScene) => {
    const index = storyboard.findIndex((item) => item.id === scene.id); const next = [...storyboard];
    next.splice(index + 1, 0, { ...scene, id: `${scene.id}-${crypto.randomUUID()}`, title: `${scene.title} ${t('copySuffix')}` }); onEdit?.({ videoStoryboard: next });
  };

  useEffect(() => {
    if (!data.renderedVideoStorageKey) return;
    void youtubeApi.connections().then((result) => {
      setYoutubeConfigured(result.configured);
      setYoutubeConnections(result.connections);
      setYoutubeConnectionId((current) => current ?? result.connections.find((item) => item.status === 'connected')?.id ?? null);
    }).catch(() => setProblem(t('youtubeConnectionsFailed')));
  }, [data.renderedVideoStorageKey, t]);

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
    setProblem(null);
    try {
      const source = await storeCanvasMedia(file, captureKind);
      const resolvedTrack = track ?? (source.kind === 'audio' ? 'music' : 'visual');
      commit(appendCanvasVideoSource(timeline, source, resolvedTrack), [...sources, source]);
    } catch {
      setProblem(t('mediaFailed'));
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
    setProblem(null);
    setPlaying(false);
    setRenderProgress(0);
    try {
      const blob = await renderCanvasVideo(timeline, sources, setRenderProgress);
      const url = URL.createObjectURL(blob);
      const fileName = `${data.title || 'video'}.webm`;
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const rendition = await storeCanvasMedia(new File([blob], fileName, { type: blob.type }), 'import');
      commit(timeline, sources, { renderedVideoUrl: rendition.url, renderedVideoStorageKey: rendition.storageKey, renderedVideoMimeType: blob.type, status: t('exported') });
    } catch {
      setProblem(t('renderFailed'));
    } finally {
      setBusy(null);
    }
  };

  const connectYouTube = async () => {
    setBusy(t('connectingYouTube')); setProblem(null);
    try {
      const { authUrl } = await youtubeApi.connectUrl(`${window.location.pathname}${window.location.search}`);
      window.location.assign(authUrl);
    } catch { setProblem(t('youtubeConnectFailed')); setBusy(null); }
  };

  const publishYouTube = async () => {
    if (!youtubeConnectionId || !data.renderedVideoStorageKey || !data.renderedVideoMimeType) return;
    setBusy(t('publishingYouTube')); setProblem(null);
    try {
      const published = await youtubeApi.publish({ connectionId: youtubeConnectionId, storageKey: data.renderedVideoStorageKey as string, title: youtubeTitle, description: youtubeDescription, privacyStatus: youtubePrivacy, mimeType: data.renderedVideoMimeType as string });
      commit(timeline, sources, { youtubeVideoId: published.videoId, youtubeUrl: published.url, youtubePrivacyStatus: published.privacyStatus, status: t('uploadedYouTube') });
    } catch { setProblem(t('youtubePublishFailed')); } finally { setBusy(null); }
  };

  const activeClips = timeline.clips.filter((clip) => playhead >= clip.startSeconds && playhead < clip.startSeconds + clip.durationSeconds);
  return <div className={`${styles.editor} nodrag nowheel`} onClick={stop}>
    <div className={styles.preview} style={{ backgroundColor: timeline.backgroundColor }}>
      {activeClips.length === 0 && <span>{t('emptyPreview')}</span>}
      {activeClips.map((clip) => {
        const source = sourcesById.get(clip.sourceId);
        return source ? <PreviewMedia key={clip.id} clip={clip} source={source} playhead={playhead} playing={playing} /> : null;
      })}
      {activeClips.find((clip) => clip.track === 'visual' && clip.captions)?.captions && <div className={styles.previewCaptions}>{activeClips.find((clip) => clip.track === 'visual' && clip.captions)?.captions}</div>}
      <div className={styles.transport}>
        <button type="button" disabled={!timeline.clips.length} onClick={() => { if (playhead >= duration) setPlayhead(0); setPlaying((value) => !value); }}>{playing ? t('pause') : t('play')}</button>
        <input aria-label={t('playhead')} type="range" min="0" max={duration} step="0.05" value={Math.min(playhead, duration)} onChange={(event) => { setPlaying(false); setPlayhead(Number(event.target.value)); }} />
        <time>{time(playhead)} / {time(duration)}</time>
      </div>
    </div>

    <div className={styles.captureBar}>
      <label>{t('importMedia')}<input disabled={!editable} type="file" accept="video/*,image/*" onChange={picked('visual')} /></label>
      <label>{t('addMusic')}<input disabled={!editable} type="file" accept="audio/*" onChange={picked('music')} /></label>
      {!capture.mode && <button type="button" disabled={!editable || !capture.isSupported || !!busy} onClick={() => void capture.start('screen')}>{t('recordScreen')}</button>}
      {!capture.mode && <button type="button" disabled={!editable || !capture.isSupported || !!busy} onClick={() => void capture.start('camera')}>{t('recordCamera')}</button>}
      {capture.mode && <button type="button" className={styles.recording} onClick={() => void finishCapture()}>{t('stopRecording', { seconds: Math.round(capture.durationMs / 1000) })}</button>}
      <button type="button" disabled={!timeline.clips.length || !!busy} onClick={() => void exportVideo()}>{t('exportVideo')}</button>
    </div>
    {capture.error && capture.error !== 'cancelled' && <p role="alert" className={styles.status}>{t(capture.error === 'unsupported' ? 'captureUnsupported' : 'captureFailed')}</p>}
    {problem && <p role="alert" className={styles.status}>{problem}</p>}
    {busy && <p role="status" className={styles.status}>{busy}{busy === t('rendering') ? ` · ${Math.round(renderProgress * 100)}%` : ''}</p>}

    <details className={styles.videoTemplates} open={!timeline.clips.length && !storyboard.length}><summary>{t('videoResumeTemplates')}</summary><div className={styles.templateFilters}><input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} placeholder={t('searchVideoTemplates')} /><select value={templateProfession} onChange={(event) => setTemplateProfession(event.target.value)}><option value="all">{t('allProfessions')}</option>{[...new Set(VIDEO_RESUME_TEMPLATES.map((template) => template.profession))].sort().map((profession) => <option key={profession}>{profession}</option>)}</select></div><div className={styles.templateGrid}>{VIDEO_RESUME_TEMPLATES.filter((template) => templateProfession === 'all' || template.profession === templateProfession).filter((template) => `${template.label} ${template.profession} ${template.scenes.map((scene) => scene.title).join(' ')}`.toLowerCase().includes(templateSearch.trim().toLowerCase())).map((template) => <button type="button" key={template.id} aria-pressed={data.videoResumeTemplateId === template.id} disabled={!editable} onClick={() => onEdit?.(videoResumeTemplatePatch(template))}><span style={{ background: `linear-gradient(135deg,${template.colors[0]},${template.colors[1]})` }} /><strong>{template.label}</strong><small>{template.profession} · {template.duration}s · {template.scenes.length} {t('scenes')}</small></button>)}</div></details>
    {!!storyboard.length && <section className={styles.storyboard} aria-label={t('storyboard')}><header><strong>{t('storyboard')}</strong><span>{storyboard.reduce((sum, scene) => sum + scene.duration, 0)}s</span></header>{storyboard.map((scene, index) => <article key={scene.id}><b>{index + 1}</b><div><input aria-label={t('sceneTitle', { number: index + 1 })} value={scene.title} disabled={!editable} onChange={(event) => updateStoryboard(scene.id, { title: event.target.value })} />{scene.subtitle && <small>{scene.subtitle}</small>}</div><label>{t('length')}<input type="number" min="1" value={scene.duration} disabled={!editable} onChange={(event) => updateStoryboard(scene.id, { duration: Math.max(1, Number(event.target.value)) })} /></label><label>{t('transition')}<select value={scene.transition ?? 'fade'} disabled={!editable} onChange={(event) => updateStoryboard(scene.id, { transition: event.target.value as VideoResumeScene['transition'] })}>{(['cut','fade','slide','zoom'] as const).map((transition) => <option key={transition} value={transition}>{t(`transition_${transition}`)}</option>)}</select></label><div className={styles.sceneActions}><button type="button" disabled={!editable || index === 0} aria-label={t('moveSceneEarlier', { title: scene.title })} onClick={() => moveStoryboardScene(scene.id, -1)}>↑</button><button type="button" disabled={!editable || index === storyboard.length - 1} aria-label={t('moveSceneLater', { title: scene.title })} onClick={() => moveStoryboardScene(scene.id, 1)}>↓</button><button type="button" disabled={!editable} aria-label={t('duplicateScene', { title: scene.title })} onClick={() => duplicateStoryboardScene(scene)}>⧉</button><button type="button" disabled={!editable || storyboard.length === 1} aria-label={t('deleteScene', { title: scene.title })} onClick={() => onEdit?.({ videoStoryboard: storyboard.filter((item) => item.id !== scene.id) })}>×</button></div></article>)}</section>}

    {typeof data.renderedVideoStorageKey === 'string' && !!data.renderedVideoStorageKey && <section className={styles.publish} aria-label={t('youtubePublishing')}>
      <header><strong>{t('youtubePublishing')}</strong><span>{data.youtubeUrl ? t('uploadedYouTube') : t('readyToPublish')}</span></header>
      {!youtubeConfigured && <p>{t('youtubeDeploymentMissing')}</p>}
      {youtubeConfigured && !youtubeConnections.length && <button type="button" disabled={!!busy} onClick={() => void connectYouTube()}>{t('connectYouTube')}</button>}
      {youtubeConnections.length > 0 && <>
        <label>{t('youtubeAccount')}<select value={youtubeConnectionId ?? ''} onChange={(event) => setYoutubeConnectionId(Number(event.target.value))}>{youtubeConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName || connection.accountEmail}</option>)}</select></label>
        <label>{t('youtubeTitle')}<input value={youtubeTitle} maxLength={100} onChange={(event) => setYoutubeTitle(event.target.value)} /></label>
        <label>{t('youtubeDescription')}<textarea value={youtubeDescription} maxLength={5000} onChange={(event) => setYoutubeDescription(event.target.value)} /></label>
        <label>{t('youtubeVisibility')}<select value={youtubePrivacy} onChange={(event) => setYoutubePrivacy(event.target.value as typeof youtubePrivacy)}><option value="private">{t('visibilityPrivate')}</option><option value="unlisted">{t('visibilityUnlisted')}</option><option value="public">{t('visibilityPublic')}</option></select></label>
        <button type="button" disabled={!!busy || !youtubeTitle.trim()} onClick={() => void publishYouTube()}>{t('publishYouTube')}</button>
      </>}
      {typeof data.youtubeUrl === 'string' && <a href={data.youtubeUrl} target="_blank" rel="noreferrer">{t('viewOnYouTube')}</a>}
    </section>}

    <div className={styles.timeline} role="region" aria-label={t('timeline')}>
      {TRACKS.map((track) => <section key={track}>
        <header><strong>{t(`track_${track}`)}</strong><span>{timeline.clips.filter((clip) => clip.track === track).length}</span></header>
        <div>
          {timeline.clips.filter((clip) => clip.track === track).map((clip) => <article key={clip.id} className={styles.clip}>
            <b title={clip.label}>{clip.label}</b>
            <label>{t('start')}<input disabled={!editable} type="number" min="0" step="0.1" value={clip.startSeconds} onChange={(event) => commit(patchCanvasVideoClip(timeline, clip.id, { startSeconds: Number(event.target.value) }))} /></label>
            <label>{t('length')}<input disabled={!editable} type="number" min="0.1" step="0.1" value={clip.durationSeconds} onChange={(event) => commit(patchCanvasVideoClip(timeline, clip.id, { durationSeconds: Number(event.target.value) }))} /></label>
            <label>{t('trim')}<input disabled={!editable} type="number" min="0" step="0.1" value={clip.trimStartSeconds} onChange={(event) => commit(patchCanvasVideoClip(timeline, clip.id, { trimStartSeconds: Number(event.target.value) }))} /></label>
            {track !== 'visual' && <label>{t('volume')}<input disabled={!editable} type="range" min="0" max="2" step="0.05" value={clip.volume} onChange={(event) => commit(patchCanvasVideoClip(timeline, clip.id, { volume: Number(event.target.value) }))} /></label>}
            {track === 'visual' && <details className={styles.clipText}><summary>{t('captionsAndChapter')}</summary><label>{t('caption')}<textarea disabled={!editable} value={clip.captions ?? ''} onChange={(event) => commit(patchCanvasVideoClip(timeline, clip.id, { captions: event.target.value }))} /></label><label>{t('chapter')}<input disabled={!editable} value={clip.chapterTitle ?? ''} onChange={(event) => commit(patchCanvasVideoClip(timeline, clip.id, { chapterTitle: event.target.value }))} /></label></details>}
            <div className={styles.clipActions}><button disabled={!editable} type="button" aria-label={t('moveClipEarlier', { name: clip.label })} onClick={() => commit(moveCanvasVideoClip(timeline, clip.id, -1))}>←</button><button disabled={!editable} type="button" aria-label={t('moveClipLater', { name: clip.label })} onClick={() => commit(moveCanvasVideoClip(timeline, clip.id, 1))}>→</button><button disabled={!editable || playhead <= clip.startSeconds || playhead >= clip.startSeconds + clip.durationSeconds} type="button" aria-label={t('splitClip', { name: clip.label })} onClick={() => commit(splitCanvasVideoClip(timeline, clip.id, playhead))}>✂</button></div>
            <button disabled={!editable} type="button" aria-label={t('removeClip', { name: clip.label })} onClick={() => commit(removeCanvasVideoClip(timeline, clip.id))}>×</button>
          </article>)}
          {!timeline.clips.some((clip) => clip.track === track) && <span className={styles.emptyTrack}>{t('emptyTrack')}</span>}
        </div>
      </section>)}
    </div>
  </div>;
}
