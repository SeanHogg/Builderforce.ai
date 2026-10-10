import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChatInput } from '@/components/ChatInput';
import { CLOUD_SHOT_SECONDS } from '@/lib/sceneStoryboard';
import { MEDIA_SHAPES, type MediaRequest, type MediaShape } from './mediaRequest';
import styles from './MediaPanel.module.css';

/**
 * Generate without going through the chat: a prompt, image or video, a shape
 * (and a length for video). The result lands in the library below, the same
 * library the agent's own generations land in.
 *
 * The prompt is THE one composer every prompt uses (`ChatInput`) — the box, its tool
 * row and its one trailing button — with shape and length as compact choices in that
 * row, instead of a page-local textarea, labelled selects and a Generate button.
 */
export function MediaGenerateForm({ onGenerate }: { onGenerate: (request: MediaRequest) => Promise<unknown> }) {
  const t = useTranslations('ide.media');
  const [kind, setKind] = useState<MediaRequest['kind']>('image');
  const [prompt, setPrompt] = useState('');
  const [shape, setShape] = useState<MediaShape>('landscape');
  const [seconds, setSeconds] = useState<number>(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onGenerate(kind === 'image' ? { kind, prompt: text, shape } : { kind, prompt: text, shape, durationSeconds: seconds });
      setPrompt('');
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t('generateFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-label={t('generateTitle')}>
      <h3 className={styles.sectionTitle}>{t('generateTitle')}</h3>
      <div className={styles.kindSwitch} role="group" aria-label={t('kindLabel')}>
        <button type="button" aria-pressed={kind === 'image'} onClick={() => setKind('image')}>{t('kindImage')}</button>
        <button type="button" aria-pressed={kind === 'video'} onClick={() => setKind('video')}>{t('kindVideo')}</button>
      </div>
      <ChatInput
        value={prompt}
        onChange={setPrompt}
        onSubmit={() => void submit()}
        placeholder={t(kind === 'image' ? 'promptPlaceholderImage' : 'promptPlaceholderVideo')}
        ariaLabel={t('promptLabel')}
        submitLabel={busy ? t(kind === 'video' ? 'generatingVideo' : 'generatingImage') : t('generate')}
        disabled={busy}
        rows={2}
        contextControls={<>
          <select className={styles.select} value={shape} disabled={busy} aria-label={t('shapeLabel')} title={t('shapeLabel')} onChange={(event) => setShape(event.target.value as MediaShape)}>
            {MEDIA_SHAPES.map((option) => <option key={option} value={option}>{t(`shape.${option}`)}</option>)}
          </select>
          {kind === 'video' && (
            <select className={styles.select} value={seconds} disabled={busy} aria-label={t('lengthLabel')} title={t('lengthLabel')} onChange={(event) => setSeconds(Number(event.target.value))}>
              {CLOUD_SHOT_SECONDS.map((option) => <option key={option} value={option}>{t('seconds', { seconds: option })}</option>)}
            </select>
          )}
        </>}
      />
      {busy && <p className={styles.status} role="status">{t(kind === 'video' ? 'generatingVideo' : 'generatingImage')}</p>}
      {kind === 'video' && <p className={styles.status}>{t('videoHint')}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
