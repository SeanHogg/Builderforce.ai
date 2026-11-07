/**
 * The browser's `Writer` API — the ONE detection of it (PRD 42 · B2). An origin / developer
 * trial in Chrome, previewed in Edge: absent is the common case and reads as `null`.
 */

import {
  taskApiReady, withTaskSession,
  type BuiltInAdapter, type TaskApiFactory, type TaskApiSession,
} from './taskSession';

interface WriterSession extends TaskApiSession {
  write(task: string, opts?: { context?: string; signal?: AbortSignal }): Promise<string>;
}

interface WriterCreateOptions {
  format: 'plain-text' | 'markdown';
  length: 'short' | 'medium' | 'long';
  sharedContext?: string;
}

type WriterFactory = TaskApiFactory<WriterSession, WriterCreateOptions>;

function writerFactory(): WriterFactory | null {
  if (typeof globalThis === 'undefined') return null;
  return (globalThis as unknown as { Writer?: WriterFactory }).Writer ?? null;
}

export const writerAdapter: BuiltInAdapter = {
  id: 'writer',
  kinds: ['write'],
  ready: () => taskApiReady(writerFactory(), { format: 'plain-text', length: 'medium' }),
  write: (task, o) =>
    withTaskSession(writerFactory(), { format: 'plain-text', length: o?.length ?? 'medium' }, o?.signal, async (session) => {
      const out = await session.write(task, { ...(o?.context ? { context: o.context } : {}), ...(o?.signal ? { signal: o.signal } : {}) });
      return out.trim() ? out.trim() : null;
    }),
};
