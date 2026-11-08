import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DrawingPen } from '@/lib/canvasDrawing';
import { DrawingPenTray } from '@/components/drawing/DrawingPenTray';
import styles from './ImageEditor.module.css';

export interface ImageAnnotateToolsProps {
  pen: DrawingPen;
  onChoose: (patch: Partial<DrawingPen>) => void;
  canUndo: boolean;
  onUndo: () => void;
  /** Set when the text tool was tapped on the picture and is waiting for its words. */
  textPending: boolean;
  onCommitText: (text: string) => void;
  onCancelText: () => void;
}

/** The shared pen tray plus what an image needs beside it: undo, and the words for a text mark. */
export function ImageAnnotateTools({ pen, onChoose, canUndo, onUndo, textPending, onCommitText, onCancelText }: ImageAnnotateToolsProps) {
  const t = useTranslations('canvas.kinds.image');
  const [text, setText] = useState('');
  const commit = () => { if (text.trim()) onCommitText(text.trim()); setText(''); };
  return <DrawingPenTray pen={pen} onChoose={onChoose}>
    <button type="button" className={styles.toolButton} disabled={!canUndo} onClick={onUndo}>{t('undoMark')}</button>
    {textPending && <form className={styles.textEntry} onSubmit={(event) => { event.preventDefault(); commit(); }}>
      <input autoFocus value={text} maxLength={200} aria-label={t('textLabel')} placeholder={t('textPlaceholder')} onChange={(event) => setText(event.target.value)} />
      <button type="submit" className={styles.toolButton} disabled={!text.trim()}>{t('addText')}</button>
      <button type="button" className={styles.toolButton} onClick={() => { setText(''); onCancelText(); }}>{t('cancel')}</button>
    </form>}
  </DrawingPenTray>;
}
