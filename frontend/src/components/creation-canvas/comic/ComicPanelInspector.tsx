import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../styles/creativeEditors.module.css';
import type { ComicBubble, ComicBubbleKind, ComicPanel } from '@/lib/creation/comic/comicState';
import { storeComicImage } from '@/lib/creation/comic/comicImage';
import { CreationStorageError } from '@/lib/creation/exportArtifact';
import { useExportPalette } from '../creative/useExportPalette';
import { useDebouncedPatch } from '../creative/useDebouncedPatch';

interface ComicPanelInspectorProps {
  panel: ComicPanel;
  panelNumber: number;
  onImage: (imageUrl: string | null) => void;
  onAddBubble: (kind: ComicBubbleKind) => void;
  onUpdateBubble: (bubbleId: string, patch: Partial<Omit<ComicBubble, 'id'>>) => void;
  onRemoveBubble: (bubbleId: string) => void;
}

const KINDS: readonly ComicBubbleKind[] = ['speech', 'thought', 'caption'];
const KIND_KEY = { speech: 'bubbleSpeech', thought: 'bubbleThought', caption: 'bubbleCaption' } as const;

/** The selected panel: its art (upload or https link) and its lettering. */
export function ComicPanelInspector({ panel, panelNumber, onImage, onAddBubble, onUpdateBubble, onRemoveBubble }: ComicPanelInspectorProps) {
  const t = useTranslations('canvas.kinds.comic');
  const fileInput = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState<'image' | 'storage' | null>(null);
  const [busy, setBusy] = useState(false);
  const palette = useExportPalette();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFailed(null);
    setBusy(true);
    try { onImage(await storeComicImage(file, palette.paper)); } catch (error) { setFailed(error instanceof CreationStorageError ? 'storage' : 'image'); } finally { setBusy(false); }
  };

  return <div className={`${styles.inspector} nodrag nowheel`}>
    <b>{t('panelNumber', { index: panelNumber })}</b>
    <div className={styles.row}>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ''; }} />
      <button type="button" className={styles.button} disabled={busy} onClick={() => fileInput.current?.click()}>{panel.imageUrl ? t('replaceImage') : t('uploadImage')}</button>
      {panel.imageUrl && <button type="button" className={styles.button} onClick={() => onImage(null)}>{t('removeImage')}</button>}
    </div>
    {failed && <span className={styles.status} role="alert">{t(failed === 'storage' ? 'imageNotSaved' : 'imageFailed')}</span>}

    <div className={styles.row} role="group" aria-label={t('addLettering')}>
      {KINDS.map((kind) => <button key={kind} type="button" className={styles.button} onClick={() => onAddBubble(kind)}>{`+ ${t(KIND_KEY[kind])}`}</button>)}
    </div>
    {panel.bubbles.map((bubble, index) => <BubbleEditor key={bubble.id} bubble={bubble} index={index + 1} onUpdate={onUpdateBubble} onRemove={onRemoveBubble} />)}
  </div>;
}

interface BubbleEditorProps {
  bubble: ComicBubble;
  index: number;
  onUpdate: (bubbleId: string, patch: Partial<Omit<ComicBubble, 'id'>>) => void;
  onRemove: (bubbleId: string) => void;
}

type BubbleDraft = Pick<ComicBubble, 'text' | 'x' | 'y'>;

/**
 * One piece of lettering. Typing and dragging a slider edit a local draft; the object is
 * written once the person pauses or leaves the field (`useDebouncedPatch`), not per
 * keystroke or slider tick.
 */
function BubbleEditor({ bubble, index, onUpdate, onRemove }: BubbleEditorProps) {
  const t = useTranslations('canvas.kinds.comic');
  const [draft, setDraft] = useState<BubbleDraft>({ text: bubble.text, x: bubble.x, y: bubble.y });
  const { schedule, flush, isPending } = useDebouncedPatch<Partial<BubbleDraft>>((patch) => onUpdate(bubble.id, patch));
  // Follow the stored lettering when it changes from elsewhere (undo, a Brain edit), but never mid-edit.
  useEffect(() => { if (!isPending()) setDraft({ text: bubble.text, x: bubble.x, y: bubble.y }); }, [bubble.text, bubble.x, bubble.y, isPending]);
  const edit = (patch: Partial<BubbleDraft>) => { setDraft((current) => ({ ...current, ...patch })); schedule(patch); };

  return <div className={styles.bubbleEditor}>
    <div className={styles.row}>
      <select value={bubble.kind} aria-label={t('bubbleKind')} onChange={(event) => { flush(); onUpdate(bubble.id, { kind: event.target.value as ComicBubbleKind }); }}>
        {KINDS.map((kind) => <option key={kind} value={kind}>{t(KIND_KEY[kind])}</option>)}
      </select>
      <button type="button" className={styles.iconButton} onClick={() => onRemove(bubble.id)} aria-label={t('deleteBubble', { index })} title={t('deleteBubble', { index })}>×</button>
    </div>
    <textarea rows={2} value={draft.text} placeholder={t('bubblePlaceholder')} aria-label={t('bubbleText', { index })} onChange={(event) => edit({ text: event.target.value })} onBlur={flush} />
    <div className={styles.row}>
      <label className={styles.field}><span>{t('positionX')}</span><input type="range" min={0} max={100} value={Math.round(draft.x * 100)} onChange={(event) => edit({ x: Number(event.target.value) / 100 })} onPointerUp={flush} onBlur={flush} /></label>
      <label className={styles.field}><span>{t('positionY')}</span><input type="range" min={0} max={100} value={Math.round(draft.y * 100)} onChange={(event) => edit({ y: Number(event.target.value) / 100 })} onPointerUp={flush} onBlur={flush} /></label>
    </div>
  </div>;
}
