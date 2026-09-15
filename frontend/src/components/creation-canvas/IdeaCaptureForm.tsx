/*
 * No `'use client'` here on purpose: imported only by `CanvasIdeasSurface`, whose own
 * importer (`CreationCanvas.tsx`) already declares the boundary.
 */
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CanvasIdeasSurface.module.css';

export interface IdeaCaptureFormProps {
  /**
   * Called with the trimmed text. ABSENT when the viewer cannot edit this canvas — the
   * form is then drawn disabled with a sentence saying why, never hidden: a scratchpad
   * that silently lacks its input reads as a broken one.
   */
  onCapture?: (text: string) => void;
}

/**
 * The scratchpad's input: type, press Capture (or Ctrl/⌘+Enter), keep typing.
 *
 * Deliberately a textarea and not a one-line field. An idea often arrives as three
 * sentences, and the whole text is kept verbatim as the card's `scratch` — the first
 * line only becomes its title.
 */
export function IdeaCaptureForm({ onCapture }: IdeaCaptureFormProps) {
  const t = useTranslations('creationCanvas.surface.ideas.capture');
  const [text, setText] = useState('');
  const inputId = useId();
  const hintId = useId();
  const disabled = !onCapture;

  const submit = () => {
    const value = text.trim();
    if (!value || !onCapture) return;
    onCapture(value);
    setText('');
  };

  return (
    <form className={styles.capture} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label className={styles.captureLabel} htmlFor={inputId}>{t('label')}</label>
      <textarea
        id={inputId}
        className={styles.captureInput}
        rows={3}
        value={text}
        placeholder={t('placeholder')}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
          // Escape leaves the surface — but not while there is an unsaved thought in the
          // box, which would be lost with it.
          if (event.key === 'Escape' && text.trim()) event.stopPropagation();
        }}
      />
      <div className={styles.captureFoot}>
        <small id={hintId} className={styles.captureHint}>{disabled ? t('readOnly') : t('hint')}</small>
        <button type="submit" className={styles.captureButton} disabled={disabled || !text.trim()}>{t('submit')}</button>
      </div>
    </form>
  );
}
