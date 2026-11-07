import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { usePickerOpener, useTranslationContext } from './context';
import { languageDisplayName } from './engine';
import { useTranslatedText } from './useTranslatedText';

export interface TranslatableTextProps {
  /** The stored text. Never modified. */
  text: string;
  /** Stable identity of the content (message id, comment id) — the cache key with the locale. */
  contentId: string;
  /** False renders the text as-is, with nothing detected or translated (e.g. the reader's own replies). Default true. */
  enabled?: boolean;
  /** How a string is drawn (Markdown, a bubble…). Default: the text as a paragraph. */
  render?: (text: string) => ReactNode;
}

/** True once the element has been on screen. Without IntersectionObserver (SSR, jsdom) it is immediately true. */
function useEverVisible(ref: RefObject<Element | null>, active: boolean): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !active) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, active, ref]);
  return seen;
}

const plainText = (text: string): ReactNode => <p className="bf-tr__text">{text}</p>;

/**
 * A piece of someone else's writing, shown in the reader's language when it is in another
 * one: "Translated from Spanish · Show original". Detection, laziness, caching and the
 * engine choice (on device first, cloud only where the mode allows) live behind it; when
 * none of that applies it renders exactly what it was given.
 */
export function TranslatableText({ text, contentId, enabled = true, render = plainText }: TranslatableTextProps) {
  const ctx = useTranslationContext();
  const openModelPicker = usePickerOpener();
  const ref = useRef<HTMLDivElement>(null);
  const visible = useEverVisible(ref, !!ctx && enabled);
  const state = useTranslatedText(text, contentId, visible && enabled);
  const [original, setOriginal] = useState(false);

  if (!ctx || !enabled) return <>{render(text)}</>;
  const { labels, locale } = ctx;
  const shown = state.status === 'translated' && !original ? state.text : text;

  return (
    <div className="bf-tr" ref={ref}>
      {render(shown)}
      {state.status === 'pending' && <span className="bf-tr__meta" aria-busy="true">{labels.translating}</span>}
      {state.status === 'translated' && (
        <span className="bf-tr__meta">
          {labels.translatedFrom.replace('{language}', languageDisplayName(state.from, locale))}
          {' · '}
          <button type="button" className="bf-tr__link" onClick={() => setOriginal((v) => !v)} aria-pressed={original}>
            {original ? labels.showTranslation : labels.showOriginal}
          </button>
        </span>
      )}
      {state.status === 'needs-device' && (
        <span className="bf-tr__meta">
          {labels.needsTranslator}
          {openModelPicker && (
            <>
              {' · '}
              <button type="button" className="bf-tr__link" onClick={openModelPicker}>{labels.getTranslator}</button>
            </>
          )}
        </span>
      )}
    </div>
  );
}
