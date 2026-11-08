import { useTranslations } from 'next-intl';
import { clockTime, type PodcastSegment } from '@/lib/creation/podcast/podcastEpisode';
import styles from './PodcastEditor.module.css';

export interface PodcastSegmentListProps {
  segments: readonly PodcastSegment[];
  editable: boolean;
  playingClipId: string | null;
  onPlay: (clipId: string) => void;
  onMove: (clipId: string, delta: -1 | 1) => void;
  onRemove: (clipId: string) => void;
  onTrim: (clipId: string, patch: { trimStartSeconds?: number; durationSeconds?: number }) => void;
  onRename: (clipId: string, label: string) => void;
  onChapter: (clipId: string, title: string) => void;
}

/** An input that commits on blur / Enter, so typing does not write a history entry per keystroke. */
function CommitInput({ value, label, type = 'text', onCommit, disabled }: { value: string | number; label: string; type?: 'text' | 'number'; onCommit: (value: string) => void; disabled: boolean }) {
  return <input
    key={String(value)}
    className={styles.field}
    type={type}
    step={type === 'number' ? '0.1' : undefined}
    min={type === 'number' ? '0' : undefined}
    defaultValue={value}
    aria-label={label}
    disabled={disabled}
    onBlur={(event) => { if (event.target.value !== String(value)) onCommit(event.target.value); }}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
  />;
}

/** The ordered segments with their reorder, trim, chapter and remove controls. Presentational. */
export function PodcastSegmentList({ segments, editable, playingClipId, onPlay, onMove, onRemove, onTrim, onRename, onChapter }: PodcastSegmentListProps) {
  const t = useTranslations('canvas.kinds.podcast');
  if (!segments.length) return <p className={styles.empty}>{t('emptySegments')}</p>;
  return <ol className={styles.segments}>
    {segments.map(({ clip, source }, index) => <li key={clip.id} className={styles.segment} data-playing={playingClipId === clip.id || undefined}>
      <div className={styles.segmentHead}>
        <button type="button" className={styles.button} disabled={!source} onClick={() => onPlay(clip.id)} aria-label={t('playSegment', { name: clip.label })}>▶</button>
        <CommitInput value={clip.label} label={t('segmentName')} disabled={!editable} onCommit={(value) => onRename(clip.id, value)} />
        <time className={styles.time}>{clockTime(clip.startSeconds)}</time>
      </div>
      {!source && <p className={styles.problem}>{t('missingSource')}</p>}
      <div className={styles.segmentFields}>
        <label className={styles.labelled}>{t('trimStart')}<CommitInput type="number" value={Math.round(clip.trimStartSeconds * 10) / 10} label={t('trimStart')} disabled={!editable} onCommit={(value) => onTrim(clip.id, { trimStartSeconds: Number(value) })} /></label>
        <label className={styles.labelled}>{t('length')}<CommitInput type="number" value={Math.round(clip.durationSeconds * 10) / 10} label={t('length')} disabled={!editable} onCommit={(value) => onTrim(clip.id, { durationSeconds: Number(value) })} /></label>
        <label className={styles.labelled}>{t('chapter')}<CommitInput value={clip.chapterTitle ?? ''} label={t('chapter')} disabled={!editable} onCommit={(value) => onChapter(clip.id, value)} /></label>
      </div>
      {editable && <div className={styles.segmentActions}>
        <button type="button" className={styles.button} disabled={index === 0} onClick={() => onMove(clip.id, -1)} aria-label={t('moveUp')}>↑</button>
        <button type="button" className={styles.button} disabled={index === segments.length - 1} onClick={() => onMove(clip.id, 1)} aria-label={t('moveDown')}>↓</button>
        <button type="button" className={styles.button} onClick={() => onRemove(clip.id)}>{t('remove')}</button>
      </div>}
    </li>)}
  </ol>;
}
