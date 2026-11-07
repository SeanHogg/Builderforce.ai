/**
 * The browser's `Rewriter` API — the ONE detection of it (PRD 42 · B2). A trial in Chrome,
 * previewed in Edge. The Rewriter has no free-form instruction, so a rewrite carrying an
 * `instruction` is the Prompt API's (the port's route order falls through to it).
 */

import {
  taskApiReady, withTaskSession,
  type BuiltInAdapter, type TaskApiFactory, type TaskApiSession,
} from './taskSession';

interface RewriterSession extends TaskApiSession {
  rewrite(text: string, opts?: { context?: string; signal?: AbortSignal }): Promise<string>;
}

interface RewriterCreateOptions {
  tone: 'more-formal' | 'as-is' | 'more-casual';
  length: 'shorter' | 'as-is' | 'longer';
  format: 'plain-text' | 'markdown';
}

type RewriterFactory = TaskApiFactory<RewriterSession, RewriterCreateOptions>;

function rewriterFactory(): RewriterFactory | null {
  if (typeof globalThis === 'undefined') return null;
  return (globalThis as unknown as { Rewriter?: RewriterFactory }).Rewriter ?? null;
}

export const rewriterAdapter: BuiltInAdapter = {
  id: 'rewriter',
  kinds: ['rewrite'],
  ready: () => taskApiReady(rewriterFactory(), { tone: 'as-is', length: 'as-is', format: 'plain-text' }),
  rewrite: (text, o) => {
    if (o.instruction) return Promise.resolve(null);
    return withTaskSession(
      rewriterFactory(),
      { tone: o.tone ?? 'as-is', length: o.length ?? 'as-is', format: 'plain-text' },
      o.signal,
      async (session) => {
        const out = await session.rewrite(text, o.signal ? { signal: o.signal } : undefined);
        return out.trim() ? out.trim() : null;
      },
    );
  },
};
