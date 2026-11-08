import { useCallback, useMemo, useRef, useState } from 'react';
import { slugify, type CanvasVideoSource, type CanvasVideoTimeline } from '@builderforce/creation-canvas-contract';
import type { CreationNodeData } from '../types';
import { storeCanvasMedia } from '@/lib/canvasMediaStore';
import { EDITED_MEDIA_MIME } from '@/lib/creationDeliverables';
import { useExportArtifact } from '../creative/useExportArtifact';
import {
  appendPodcastSegment,
  movePodcastSegment,
  podcastChapters,
  podcastDuration,
  podcastEnclosureBytes,
  podcastEpisodeFrom,
  podcastSegments,
  podcastShowFrom,
  podcastShowNotesMarkdown,
  podcastStateFrom,
  removePodcastSegment,
  renamePodcastSegment,
  setPodcastChapter,
  trimPodcastSegment,
  type PodcastEpisodeMeta,
  type PodcastShowMeta,
} from '@/lib/creation/podcast/podcastEpisode';
import { buildPodcastFeed, type PodcastFeedProblem } from '@/lib/creation/podcast/podcastRss';
import { measureRemoteBytes } from '@/lib/creation/podcast/podcastAudioSize';
import { withPublishedEnclosure } from '@/lib/creation/podcast/podcastPublish';
import { uploadPodcastChapters } from '@/lib/creation/podcast/podcastChaptersUpload';

export type PodcastEditorProblem = 'notAudio' | 'import' | 'export';
type PodcastExportFormat = 'rss' | 'notes';

/** The words the exports write into the files and the deliverable records; the caller translates them. */
export interface PodcastEditorLabels {
  /** The heading above the chapter list in the show notes. */
  chapters: string;
  /** The notes file's format name, e.g. `Markdown`. */
  notesFormat: string;
  /** The RSS deliverable's detail line, given the segment count. */
  rssDetail: (segmentCount: number) => string;
}

/** The feed's `enclosureBytes` option, present only when the object has a known size. */
const enclosure = (object: CreationNodeData): { enclosureBytes?: number } => {
  const enclosureBytes = podcastEnclosureBytes(object);
  return enclosureBytes !== undefined ? { enclosureBytes } : {};
};

/**
 * The podcast editor's state and writes. Everything it stores rides the same object data
 * the video editor uses (a timeline of clips + sources), edited through `podcastEpisode.ts`;
 * a write is one `onEdit` patch, so history, sync and the inspector all see it.
 */
export function usePodcastEditor(data: CreationNodeData, id: string, onEdit: ((patch: Partial<CreationNodeData>) => void) | undefined, labels: PodcastEditorLabels) {
  const rawTimeline = data.podcastTimeline;
  const rawSources = data.podcastSources;
  const { timeline, sources } = useMemo(() => podcastStateFrom({ podcastTimeline: rawTimeline, podcastSources: rawSources }), [rawTimeline, rawSources]);
  const episode = useMemo(() => podcastEpisodeFrom(data.podcastEpisode), [data.podcastEpisode]);
  const show = useMemo(() => podcastShowFrom(data.podcastShow), [data.podcastShow]);
  const segments = useMemo(() => podcastSegments(timeline, sources), [timeline, sources]);
  const chapters = useMemo(() => podcastChapters(timeline), [timeline]);
  const [busy, setBusy] = useState(false);
  const [importProblem, setProblem] = useState<Exclude<PodcastEditorProblem, 'export'> | null>(null);
  const [feedProblems, setFeedProblems] = useState<PodcastFeedProblem[]>([]);
  const dataRef = useRef(data);
  dataRef.current = data;

  /** `addedBytes` records the stored size of sources added in this write, by source id (the enclosure `length`). */
  const write = useCallback((nextTimeline: CanvasVideoTimeline, nextSources: CanvasVideoSource[] = sources, addedBytes?: Record<string, number>) => {
    const used = new Set(nextTimeline.clips.map((clip) => clip.sourceId));
    const sourceBytes = Object.fromEntries(Object.entries({ ...episode.sourceBytes, ...addedBytes }).filter(([sourceId]) => used.has(sourceId)));
    onEdit?.({
      podcastTimeline: nextTimeline,
      podcastSources: nextSources.filter((source) => used.has(source.id)),
      duration: podcastDuration(nextTimeline),
      ...(addedBytes ? { podcastEpisode: { ...episode, sourceBytes } } : {}),
    } as Partial<CreationNodeData>);
  }, [episode, onEdit, sources]);

  const addFiles = useCallback(async (files: readonly File[]) => {
    setBusy(true);
    try {
      let nextTimeline = timeline;
      const nextSources = [...sources];
      const addedBytes: Record<string, number> = {};
      for (const file of files) {
        const source = await storeCanvasMedia(file, 'import');
        if (source.kind !== 'audio') { setProblem('notAudio'); continue; }
        nextSources.push(source);
        addedBytes[source.id] = file.size;
        nextTimeline = appendPodcastSegment(nextTimeline, source);
        setProblem(null);
      }
      if (nextTimeline !== timeline) write(nextTimeline, nextSources, addedBytes);
    } catch { setProblem('import'); } finally { setBusy(false); }
  }, [sources, timeline, write]);

  const patchEpisode = useCallback((patch: Partial<PodcastEpisodeMeta>) => {
    const next = { ...episode, ...patch };
    // A different master file has a different size: forget the old one until it is measured or entered.
    if (patch.audioUrl !== undefined && patch.audioUrl !== episode.audioUrl && patch.audioBytes === undefined) delete next.audioBytes;
    onEdit?.({ podcastEpisode: next } as Partial<CreationNodeData>);
    if (patch.audioUrl === undefined || patch.audioUrl === episode.audioUrl || !/^https?:\/\//i.test(patch.audioUrl)) return;
    // Ask the host for the file's size; when it will not say, show the standing "size unknown"
    // problem and leave the size field for the person to fill in.
    const url = patch.audioUrl;
    void measureRemoteBytes(url).then((bytes) => {
      const latest = podcastEpisodeFrom(dataRef.current.podcastEpisode);
      if (latest.audioUrl !== url) return;
      if (bytes === null) { setFeedProblems(['noEnclosureLength']); return; }
      setFeedProblems((current) => current.filter((problem) => problem !== 'noEnclosureLength'));
      onEdit?.({ podcastEpisode: { ...latest, audioBytes: bytes } } as Partial<CreationNodeData>);
    });
  }, [episode, onEdit]);
  const patchShow = useCallback((patch: Partial<PodcastShowMeta>) => onEdit?.({ podcastShow: { ...show, ...patch } } as Partial<CreationNodeData>), [onEdit, show]);

  const stem = slugify(String(data.title ?? ''), { maxLength: 60, fallback: 'episode' });

  // One export path (`useExportArtifact`): text stays inside the object (`inline`), the
  // deliverable's `action` says which of the two kinds it is, and a failure is UI state.
  const exporter = useExportArtifact<PodcastExportFormat>({
    data,
    artifactKind: 'podcast',
    onEdit,
    render: async (format, object) => {
      if (format === 'rss') {
        // A podcast app cannot authenticate: the enclosure and chapters in the feed are publish URLs.
        const published = await withPublishedEnclosure(object);
        const result = buildPodcastFeed(published, `builderforce:${id}`, new Date(), { ...enclosure(object), chaptersUrl: await uploadPodcastChapters(chapters) });
        if (!result.ok) throw new Error('podcast feed is not valid');
        return {
          blob: new Blob([result.xml], { type: `${EDITED_MEDIA_MIME.podcastRss};charset=utf-8` }), fileName: `${stem}-feed.xml`, mimeType: EDITED_MEDIA_MIME.podcastRss,
          label: 'RSS', detail: labels.rssDetail(segments.length), action: 'export-rss', inline: true,
        };
      }
      const notes = podcastShowNotesMarkdown(String(object.title ?? ''), episode, chapters, labels.chapters);
      return {
        blob: new Blob([notes], { type: `${EDITED_MEDIA_MIME.podcastShowNotes};charset=utf-8` }), fileName: `${stem}-notes.md`, mimeType: EDITED_MEDIA_MIME.podcastShowNotes,
        label: labels.notesFormat, detail: labels.notesFormat, action: 'export-notes', inline: true,
      };
    },
  });

  const { run } = exporter;
  const exportRss = useCallback(() => {
    const result = buildPodcastFeed(dataRef.current, `builderforce:${id}`, new Date(), enclosure(dataRef.current));
    if (!result.ok) { setFeedProblems(result.problems); return; }
    setFeedProblems([]);
    void run('rss');
  }, [run, id]);

  const exportShowNotes = useCallback(() => { void run('notes'); }, [run]);
  const problem: PodcastEditorProblem | null = exporter.status === 'failed' ? 'export' : importProblem;

  return {
    editable: !!onEdit, timeline, sources, segments, chapters, episode, show, busy: busy || exporter.status === 'busy', problem, feedProblems, exportStatus: exporter.status,
    addFiles, patchEpisode, patchShow, exportRss, exportShowNotes,
    move: (clipId: string, delta: -1 | 1) => write(movePodcastSegment(timeline, clipId, delta)),
    remove: (clipId: string) => write(removePodcastSegment(timeline, clipId)),
    trim: (clipId: string, patch: { trimStartSeconds?: number; durationSeconds?: number }) => write(trimPodcastSegment(timeline, sources, clipId, patch)),
    rename: (clipId: string, label: string) => write(renamePodcastSegment(timeline, clipId, label)),
    setChapter: (clipId: string, title: string) => write(setPodcastChapter(timeline, clipId, title)),
  };
}
