import { useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { CreationNodeData } from '../types';
import { clockTime, podcastDuration } from '@/lib/creation/podcast/podcastEpisode';
import type { PodcastFeedProblem } from '@/lib/creation/podcast/podcastRss';
import type { CreationBodyProps } from '../bodies/types';
import { useCreationNodeActions } from '../bodies/nodeActions';
import { PodcastMetaForm } from './PodcastMetaForm';
import { PodcastSegmentList } from './PodcastSegmentList';
import { ExportNotice } from '../creative/ExportNotice';
import { usePodcastEditor } from './usePodcastEditor';
import { usePodcastPlayback } from './usePodcastPlayback';
import styles from './PodcastEditor.module.css';

type Tab = 'segments' | 'details';
const TABS: readonly Tab[] = ['segments', 'details'];

/**
 * The `podcast` card: an episode authored from audio segments — ordered, trimmed,
 * chaptered — with show notes and an RSS 2.0 export. The container wires the editor
 * state (`usePodcastEditor`) and playback (`usePodcastPlayback`) to presentational parts.
 */
export function PodcastEditorBody({ id, data }: CreationBodyProps) {
  const { edit: onEdit } = useCreationNodeActions();
  const t = useTranslations('canvas.kinds.podcast');
  const editor = usePodcastEditor(data, id, onEdit, {
    chapters: t('chapters'),
    notesFormat: t('formatMarkdown'),
    rssDetail: (count) => t('detailRss', { count }),
  });
  const playback = usePodcastPlayback(editor.segments);
  const [tab, setTab] = useState<Tab>('segments');
  const tabLabel: Record<Tab, string> = { segments: t('tab.segments'), details: t('tab.details') };
  const problemLabel = { notAudio: t('problem.notAudio'), import: t('problem.import'), export: t('problem.export') };
  const feedProblemLabel: Record<PodcastFeedProblem, string> = {
    noSegments: t('feedProblem.noSegments'),
    noEnclosure: t('feedProblem.noEnclosure'),
    noEnclosureLength: t('feedProblem.noEnclosureLength'),
    noShowTitle: t('feedProblem.noShowTitle'),
    noOwnerEmail: t('feedProblem.noOwnerEmail'),
    noImage: t('feedProblem.noImage'),
    noLink: t('feedProblem.noLink'),
  };
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length) void editor.addFiles(files);
  };

  return <div className={`${styles.editor} nodrag`}>
    <audio ref={playback.audioRef} src={playback.src || undefined} preload="metadata" onLoadedMetadata={playback.onLoadedMetadata} onTimeUpdate={playback.onTimeUpdate} onEnded={playback.stop} />
    <div className={styles.transport}>
      <button type="button" className={styles.button} disabled={!editor.segments.length} onClick={playback.toggle} aria-label={playback.playing ? t('pause') : t('play')}>{playback.playing ? '⏸' : '▶'}</button>
      <time className={styles.time}>{clockTime(playback.elapsed)} / {clockTime(podcastDuration(editor.timeline))}</time>
      <span className={styles.count}>{t('segmentCount', { count: editor.segments.length })}</span>
    </div>

    <div className={styles.row} role="tablist" aria-label={t('sections')}>
      {TABS.map((section) => <button key={section} type="button" role="tab" className={styles.button} aria-selected={tab === section} onClick={() => setTab(section)}>{tabLabel[section]}</button>)}
    </div>

    {tab === 'segments' && <>
      <PodcastSegmentList
        segments={editor.segments}
        editable={editor.editable}
        playingClipId={playback.playing ? playback.currentClipId : null}
        onPlay={playback.playFrom}
        onMove={editor.move}
        onRemove={editor.remove}
        onTrim={editor.trim}
        onRename={editor.rename}
        onChapter={editor.setChapter}
      />
      {editor.chapters.length > 0 && <ul className={styles.chapterList} aria-label={t('chapters')}>
        {editor.chapters.map((chapter) => <li key={`${chapter.startTimeSec}-${chapter.title}`}><time>{clockTime(chapter.startTimeSec)}</time> {chapter.title}</li>)}
      </ul>}
    </>}
    {tab === 'details' && <PodcastMetaForm
      title={String(data.title ?? '')}
      episode={editor.episode}
      show={editor.show}
      editable={editor.editable}
      onTitle={(title) => onEdit?.({ title } as Partial<CreationNodeData>)}
      onEpisode={editor.patchEpisode}
      onShow={editor.patchShow}
    />}

    {editor.problem && <p className={styles.problem} role="alert">{problemLabel[editor.problem]}</p>}
    <ExportNotice status={editor.exportStatus} />
    {editor.feedProblems.length > 0 && <ul className={styles.problem} role="alert">
      {editor.feedProblems.map((problem) => <li key={problem}>{feedProblemLabel[problem]}</li>)}
    </ul>}

    {editor.editable && <div className={styles.row}>
      <label className={styles.button}>
        {t('addAudio')}
        <input type="file" accept="audio/*" multiple className={styles.fileInput} disabled={editor.busy} onChange={pick} />
      </label>
      <button type="button" className={styles.button} onClick={editor.exportRss}>{t('exportRss')}</button>
      <button type="button" className={styles.button} onClick={editor.exportShowNotes}>{t('exportNotes')}</button>
    </div>}
  </div>;
}
