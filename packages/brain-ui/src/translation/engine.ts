/**
 * The ONE engine choice for translation (PRD 42 · E3), shared by `<TranslatableText>` and the
 * canvas import offer: detect on the device, translate on the device first, and reach for the
 * cloud only when the host handed one over (Hybrid / Specific, signed in).
 */
import type { TranslationContextValue } from './context';

/** Below this the detector is guessing; the text is left alone. */
export const MIN_DETECT_CONFIDENCE = 0.6;

export const baseLanguage = (code: string): string => code.toLowerCase().split(/[-_]/)[0] ?? '';

/** A language's name in the reader's language ("Spanish", "Spanisch"), the code itself when the runtime cannot name it. */
export function languageDisplayName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

type Wiring = Pick<TranslationContextValue, 'tasks' | 'cloud' | 'locale'>;

export type DetectedForeign =
  /** In the reader's language, or the detector is unsure — leave it alone. `known` is true for a real verdict (cacheable). */
  | { foreign: false; known: boolean }
  | { foreign: true; lang: string };

export async function detectForeignLanguage(wiring: Wiring, text: string): Promise<DetectedForeign> {
  const detected = wiring.tasks ? await wiring.tasks.detectLanguage(text).catch(() => null) : null;
  if (!detected) return { foreign: false, known: false };
  if (detected.confidence < MIN_DETECT_CONFIDENCE || baseLanguage(detected.lang) === baseLanguage(wiring.locale)) {
    return { foreign: false, known: true };
  }
  return { foreign: true, lang: detected.lang };
}

export type EngineResult =
  | { ok: true; texts: string[] }
  /** `needs-device`: nothing here can translate and no cloud is allowed. `failed`: the cloud refused or was unreachable. */
  | { ok: false; reason: 'needs-device' | 'failed' };

export async function translateWithEngines(wiring: Wiring, texts: string[], from: string, signal?: AbortSignal): Promise<EngineResult> {
  const out: Array<string | null> = [];
  for (const text of texts) {
    if (signal?.aborted) return { ok: false, reason: 'failed' };
    out.push(wiring.tasks ? await wiring.tasks.translate(text, { from, to: wiring.locale, ...(signal ? { signal } : {}) }).catch(() => null) : null);
  }
  const missing = out.flatMap((value, index) => (value === null ? [index] : []));
  if (missing.length === 0) return { ok: true, texts: out as string[] };
  if (!wiring.cloud) return { ok: false, reason: 'needs-device' };
  try {
    const cloud = await wiring.cloud(missing.map((i) => texts[i]!), wiring.locale, from);
    for (const [slot, index] of missing.entries()) {
      const value = cloud[slot];
      if (typeof value !== 'string') return { ok: false, reason: 'failed' };
      out[index] = value;
    }
    return { ok: true, texts: out as string[] };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
