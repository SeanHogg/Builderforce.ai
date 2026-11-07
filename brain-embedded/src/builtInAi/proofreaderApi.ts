/**
 * The browser's `Proofreader` API — the ONE detection of it (PRD 42 · B2). An origin trial.
 */

import {
  taskApiReady, withTaskSession,
  type BuiltInAdapter, type TaskApiFactory, type TaskApiSession,
} from './taskSession';

interface ProofreaderSession extends TaskApiSession {
  proofread(text: string, opts?: { signal?: AbortSignal }): Promise<{ correctedInput?: string; correction?: string }>;
}

interface ProofreaderCreateOptions {
  expectedInputLanguages: string[];
}

type ProofreaderFactory = TaskApiFactory<ProofreaderSession, ProofreaderCreateOptions>;

function proofreaderFactory(): ProofreaderFactory | null {
  if (typeof globalThis === 'undefined') return null;
  return (globalThis as unknown as { Proofreader?: ProofreaderFactory }).Proofreader ?? null;
}

const OPTIONS: ProofreaderCreateOptions = { expectedInputLanguages: ['en'] };

export const proofreaderAdapter: BuiltInAdapter = {
  id: 'proofreader',
  kinds: ['proofread'],
  ready: () => taskApiReady(proofreaderFactory(), OPTIONS),
  proofread: (text, o) =>
    withTaskSession(proofreaderFactory(), OPTIONS, o?.signal, async (session) => {
      const out = await session.proofread(text, o?.signal ? { signal: o.signal } : undefined);
      // The trial surface has named the corrected text both `correctedInput` and `correction`.
      const corrected = out.correctedInput ?? out.correction;
      return typeof corrected === 'string' && corrected.trim() ? corrected : null;
    }),
};
