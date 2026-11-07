/**
 * The browser's `Summarizer` API — the ONE detection of it (PRD 42 · B2). Structurally
 * typed: no ambient DOM lib. Chrome 138+ ships it; Edge previews it.
 */

import type { SummarizeOptions } from '../onDevice/onDeviceTasks';
import {
  downloadTaskModel, nullOnFailure, sessionBudget, taskApiReady, withTaskSession,
  type BuiltInAdapter, type InputBudget, type TaskApiFactory, type TaskApiSession,
} from './taskSession';

interface SummarizerSession extends TaskApiSession {
  summarize(text: string, opts?: { context?: string; signal?: AbortSignal }): Promise<string>;
}

interface SummarizerCreateOptions {
  type: 'tldr' | 'key-points' | 'teaser' | 'headline';
  format: 'plain-text' | 'markdown';
  length: 'short' | 'medium' | 'long';
  sharedContext?: string;
}

type SummarizerFactory = TaskApiFactory<SummarizerSession, SummarizerCreateOptions>;

function summarizerFactory(): SummarizerFactory | null {
  if (typeof globalThis === 'undefined') return null;
  return (globalThis as unknown as { Summarizer?: SummarizerFactory }).Summarizer ?? null;
}

/** ≤40 words → short, ≤120 → medium, otherwise long (a transcript is long by default). */
const lengthFor = (o: SummarizeOptions): SummarizerCreateOptions['length'] =>
  o.maxWords === undefined ? (o.kind === 'transcript' ? 'long' : 'medium') : o.maxWords <= 40 ? 'short' : o.maxWords <= 120 ? 'medium' : 'long';

const createOptions = (o: SummarizeOptions): SummarizerCreateOptions => ({
  type: o.kind === 'key-points' ? 'key-points' : 'tldr',
  format: 'plain-text',
  length: lengthFor(o),
  ...(o.context ? { sharedContext: o.context } : {}),
});

export const summarizerAdapter: BuiltInAdapter = {
  id: 'summarizer',
  kinds: ['summarize'],
  ready: () => taskApiReady(summarizerFactory(), createOptions({ kind: 'tldr' })),
  download: (o) => downloadTaskModel(summarizerFactory(), createOptions({ kind: 'tldr' }), o),
  budget: (signal): Promise<InputBudget | null> =>
    nullOnFailure(async () => {
      const options = createOptions({ kind: 'transcript' });
      const factory = summarizerFactory();
      if (!(await taskApiReady(factory, options))) return null;
      const session = await factory!.create({ ...options, ...(signal ? { signal } : {}) });
      const budget = sessionBudget(session);
      if (!budget) session.destroy?.();
      return budget;
    }, signal),
  summarize: (text, o) =>
    withTaskSession(summarizerFactory(), createOptions(o), o.signal, async (session) => {
      const out = await session.summarize(text, { ...(o.context ? { context: o.context } : {}), ...(o.signal ? { signal: o.signal } : {}) });
      return out.trim() ? out.trim() : null;
    }),
};
