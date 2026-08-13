'use client';

/**
 * "Read this to me" — one control, wherever there are words.
 *
 * The platform had exactly one use of the browser's speech synthesiser, buried
 * in the meetings room for captions, so nothing a person wrote or generated
 * could be listened to. That excludes anyone reading below the register the
 * model happened to write in — a lower reading level, dyslexia, a second
 * language, tired eyes at the end of a day — from content that is sitting right
 * there on the screen.
 *
 * It decides its own visibility, per the shared-component rule: no caller passes
 * a `canSpeak` boolean, because the same two facts that answer "should this
 * button exist" (is there prose, does this browser speak) are the facts it needs
 * anyway.
 */

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';

export interface ReadAloudProps {
  /** Plain prose. Callers on the canvas get it from `canvasProseText`. */
  text: string;
  className?: string;
}

/** The voice locale for a page rendered in this locale — a French board read in
 * an English voice is worse than no voice. */
function speechLang(locale: string): string {
  const map: Record<string, string> = { en: 'en-US', zh: 'zh-CN', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' };
  return map[locale] ?? locale;
}

export function ReadAloud({ text, className }: ReadAloudProps) {
  const t = useTranslations('readAloud');
  const locale = useLocale();
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Detected in an effect, never during render: `window` does not exist while
  // the page is being rendered on the server, and a control that flickers in
  // after hydration is still better than one that crashes the render.
  useEffect(() => { setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window); }, []);

  // Leaving the surface must stop the voice. Without this, closing a card keeps
  // reading it aloud with nothing on screen to stop it.
  useEffect(() => () => { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); }, []);

  if (!supported || text.trim().length < 40) return null;

  const stop = () => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  };
  const speak = () => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLang(locale);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return <button
    type="button"
    className={className}
    aria-pressed={speaking}
    title={speaking ? t('stop') : t('play')}
    onClick={(event) => { event.stopPropagation(); if (speaking) stop(); else speak(); }}
  ><span aria-hidden><Icon source={speaking ? '⏸️' : '▶'} size={15} /></span>{speaking ? t('stop') : t('play')}</button>;
}
