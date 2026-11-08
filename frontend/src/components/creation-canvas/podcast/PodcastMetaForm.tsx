import { useTranslations } from 'next-intl';
import type { PodcastEpisodeMeta, PodcastShowMeta } from '@/lib/creation/podcast/podcastEpisode';
import styles from './PodcastEditor.module.css';

export interface PodcastMetaFormProps {
  title: string;
  episode: PodcastEpisodeMeta;
  show: PodcastShowMeta;
  editable: boolean;
  onTitle: (title: string) => void;
  onEpisode: (patch: Partial<PodcastEpisodeMeta>) => void;
  onShow: (patch: Partial<PodcastShowMeta>) => void;
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

/** Episode details, show-notes and the show-level feed settings. Presentational; each field commits on blur. */
export function PodcastMetaForm({ title, episode, show, editable, onTitle, onEpisode, onShow }: PodcastMetaFormProps) {
  const t = useTranslations('canvas.kinds.podcast');
  const text = (label: string, value: string, commit: (value: string) => void, type: 'text' | 'email' | 'url' = 'text') => (
    <label className={styles.labelled}>{label}<input key={value} className={styles.field} type={type} defaultValue={value} disabled={!editable} onBlur={(event) => { if (event.target.value !== value) commit(event.target.value); }} /></label>
  );
  const area = (label: string, value: string, commit: (value: string) => void, rows: number) => (
    <label className={styles.labelled}>{label}<textarea key={value} className={styles.field} rows={rows} defaultValue={value} disabled={!editable} onBlur={(event) => { if (event.target.value !== value) commit(event.target.value); }} /></label>
  );
  return <div className={styles.meta}>
    <fieldset className={styles.group}>
      <legend>{t('episode')}</legend>
      {text(t('episodeTitle'), title, onTitle)}
      {area(t('description'), episode.description, (value) => onEpisode({ description: value }), 2)}
      {area(t('showNotes'), episode.showNotes, (value) => onEpisode({ showNotes: value }), 4)}
      <div className={styles.pair}>
        <label className={styles.labelled}>{t('season')}<input key={episode.season ?? ''} className={styles.field} type="number" min="0" defaultValue={episode.season ?? ''} disabled={!editable} onBlur={(event) => onEpisode({ season: numberOrUndefined(event.target.value) } as Partial<PodcastEpisodeMeta>)} /></label>
        <label className={styles.labelled}>{t('episodeNumber')}<input key={episode.episodeNumber ?? ''} className={styles.field} type="number" min="0" defaultValue={episode.episodeNumber ?? ''} disabled={!editable} onBlur={(event) => onEpisode({ episodeNumber: numberOrUndefined(event.target.value) } as Partial<PodcastEpisodeMeta>)} /></label>
      </div>
      {text(t('masterUrl'), episode.audioUrl, (value) => onEpisode({ audioUrl: value.trim() }), 'url')}
      <label className={styles.labelled}>{t('masterBytes')}<input key={episode.audioBytes ?? ''} className={styles.field} type="number" min="0" inputMode="numeric" defaultValue={episode.audioBytes ?? ''} disabled={!editable} onBlur={(event) => { const bytes = numberOrUndefined(event.target.value); if (bytes !== episode.audioBytes) onEpisode({ audioBytes: bytes } as Partial<PodcastEpisodeMeta>); }} /></label>
      <p className={styles.hint}>{t('masterUrlHint')}</p>
    </fieldset>
    <fieldset className={styles.group}>
      <legend>{t('show')}</legend>
      {text(t('showTitle'), show.title, (value) => onShow({ title: value }))}
      {text(t('author'), show.author, (value) => onShow({ author: value }))}
      {text(t('ownerEmail'), show.ownerEmail, (value) => onShow({ ownerEmail: value.trim() }), 'email')}
      {text(t('showLink'), show.link, (value) => onShow({ link: value.trim() }), 'url')}
      {text(t('coverUrl'), show.imageUrl, (value) => onShow({ imageUrl: value.trim() }), 'url')}
      {text(t('feedUrl'), show.feedUrl, (value) => onShow({ feedUrl: value.trim() }), 'url')}
      <div className={styles.pair}>
        {text(t('category'), show.category, (value) => onShow({ category: value }))}
        {text(t('language'), show.language, (value) => onShow({ language: value.trim() }))}
      </div>
      <label className={styles.check}><input type="checkbox" checked={show.explicit} disabled={!editable} onChange={(event) => onShow({ explicit: event.target.checked })} />{t('explicit')}</label>
    </fieldset>
  </div>;
}
