/**
 * Deterministic language detection for the app's five locales (en, de, es, fr, zh) — the
 * tail of `detectLanguage` when the browser's `LanguageDetector` is absent (Firefox, Safari,
 * the VS Code webview). It needs no model: a Unicode-script check for Chinese, then a
 * stop-word frequency score for the Latin-script locales. A text in any other language or
 * script is null (never a wrong guess), and so is anything too short or too ambiguous.
 */

import type { DetectedLanguage } from './onDeviceTasks';

/** Shorter texts are not detected: too few words to score. */
export const MIN_DETECT_CHARS = 20;
/** A Latin-script answer needs this many stop-word hits ... */
const MIN_HITS = 2;
/** ... and the winner must lead the runner-up by this share of its hits. */
const MIN_MARGIN = 0.4;

const STOP_WORDS: Readonly<Record<'en' | 'de' | 'es' | 'fr', readonly string[]>> = {
  en: ['the', 'and', 'is', 'are', 'was', 'of', 'to', 'in', 'that', 'it', 'for', 'with', 'this', 'you', 'not', 'have', 'on', 'be'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'zu', 'den', 'mit', 'von', 'auf', 'für', 'sich', 'auch', 'ich', 'es'],
  es: ['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'es', 'por', 'con', 'para', 'no', 'se', 'del', 'como'],
  fr: ['le', 'la', 'les', 'des', 'et', 'est', 'un', 'une', 'de', 'du', 'que', 'pour', 'dans', 'pas', 'ce', 'qui', 'sur', 'au'],
};

const CJK = /[一-鿿㐀-䶿]/gu;
/** Kana / Hangul mark Japanese / Korean: not Chinese, and not a supported locale. */
const NOT_CHINESE = /[぀-ヿ가-힯]/u;
/** Any other non-Latin script (Cyrillic, Arabic, Greek, Hebrew, Devanagari, Thai ...). */
const OTHER_SCRIPT = /[Ͱ-ϿЀ-ԯ֐-ۿऀ-෿฀-๿]/u;

const WORD = /[\p{L}]+/gu;

function scriptShare(text: string, pattern: RegExp): number {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters === 0 ? 0 : (text.match(pattern)?.length ?? 0) / letters;
}

export function heuristicLanguage(text: string): DetectedLanguage | null {
  const trimmed = text.trim();
  const cjk = scriptShare(trimmed, CJK);
  // Chinese carries more per character: a shorter floor than the Latin scripts.
  if (cjk >= 0.3 && !NOT_CHINESE.test(trimmed) && (trimmed.match(CJK)?.length ?? 0) >= 4) return { lang: 'zh', confidence: 0.9 };
  if (trimmed.length < MIN_DETECT_CHARS) return null;
  if (cjk > 0 || OTHER_SCRIPT.test(trimmed) || NOT_CHINESE.test(trimmed)) return null;

  const words = trimmed.toLowerCase().match(WORD) ?? [];
  if (words.length < 4) return null;
  const hits = (Object.keys(STOP_WORDS) as Array<keyof typeof STOP_WORDS>)
    .map((lang) => ({ lang, hits: words.filter((w) => STOP_WORDS[lang].includes(w)).length }))
    .sort((a, b) => b.hits - a.hits);
  const [best, second] = hits as [{ lang: string; hits: number }, { lang: string; hits: number }];
  if (best.hits < MIN_HITS) return null;
  const margin = (best.hits - second.hits) / best.hits;
  if (margin < MIN_MARGIN) return null;
  // 0.6 at the margin floor, up to 0.9 for a dense, unambiguous text.
  const density = Math.min(1, best.hits / Math.max(1, words.length) / 0.3);
  return { lang: best.lang, confidence: Math.round((0.6 + 0.3 * Math.min(1, (margin + density) / 2)) * 100) / 100 };
}
