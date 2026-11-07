/**
 * The browser's `LanguageDetector` API — the ONE detection of it (PRD 42 · B2). Stable in
 * Chrome 138. There is NO generic-model fallback: a small chat model's guess is not shown.
 */

import type { DetectedLanguage } from '../onDevice/onDeviceTasks';
import {
  downloadTaskModel, taskApiReady, withTaskSession,
  type BuiltInAdapter, type TaskApiFactory, type TaskApiSession,
} from './taskSession';

interface LanguageDetectorSession extends TaskApiSession {
  detect(text: string, opts?: { signal?: AbortSignal }): Promise<Array<{ detectedLanguage?: string | null; confidence?: number }>>;
}

type LanguageDetectorFactory = TaskApiFactory<LanguageDetectorSession, Record<string, never>>;

function languageDetectorFactory(): LanguageDetectorFactory | null {
  if (typeof globalThis === 'undefined') return null;
  return (globalThis as unknown as { LanguageDetector?: LanguageDetectorFactory }).LanguageDetector ?? null;
}

export const languageDetectorAdapter: BuiltInAdapter = {
  id: 'languageDetector',
  kinds: ['detectLanguage'],
  ready: () => taskApiReady(languageDetectorFactory(), {}),
  download: (o) => downloadTaskModel(languageDetectorFactory(), {}, o),
  detectLanguage: (text): Promise<DetectedLanguage | null> =>
    withTaskSession(languageDetectorFactory(), {}, undefined, async (session) => {
      const best = (await session.detect(text))[0];
      return best && typeof best.detectedLanguage === 'string' && best.detectedLanguage !== 'und' && typeof best.confidence === 'number'
        ? { lang: best.detectedLanguage, confidence: best.confidence }
        : null;
    }),
};
