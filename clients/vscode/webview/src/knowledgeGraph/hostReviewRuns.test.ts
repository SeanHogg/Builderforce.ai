import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeEvent, KnowledgeStoredRun } from '../../../src/knowledge/knowledgeProtocol';
import { hostReviewRuns } from './hostReviewRuns';
import type { KnowledgeTransport } from './hostKnowledgeGraphSource';

function transport() {
  const listeners = new Set<(e: KnowledgeEvent) => void>();
  const call = vi.fn(async (_call: unknown) => null);
  const t = { call, onEvent: (cb: (e: KnowledgeEvent) => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; } } as unknown as KnowledgeTransport;
  return { t, call, emit: (e: KnowledgeEvent) => listeners.forEach((l) => l(e)), listeners };
}

describe('hostReviewRuns', () => {
  it('delivers every run event, whichever review stream it rides, and nothing else', () => {
    const { t, emit, listeners } = transport();
    const seen: string[] = [];
    const off = hostReviewRuns(t).subscribe((run) => seen.push(run.id));
    const run: KnowledgeStoredRun = { id: 'r1', root: 'ws', kind: 'review', startedAt: 1, updatedAt: 1, phases: [], lanes: [], steps: [], failures: [] };
    emit({ stream: 'review-3', type: 'run', run: { ...run } });
    emit({ stream: 'review-9', type: 'run', run: { ...run, id: 'r2' } });
    emit({ stream: 'review-3', type: 'progress', progress: { phase: 'extract', done: 0, total: 1 } });
    expect(seen).toEqual(['r1', 'r2']);
    off();
    expect(listeners.size).toBe(0);
  });

  it('asks the host for the list, one whole run and a stop', async () => {
    const { t, call } = transport();
    const runs = hostReviewRuns(t);
    await runs.list('ws');
    await runs.get('r1');
    await runs.stop('r1');
    expect(call.mock.calls.map((c) => c[0])).toEqual([
      { op: 'runs', rootId: 'ws' },
      { op: 'runRecord', runId: 'r1' },
      { op: 'stopRun', runId: 'r1' },
    ]);
  });
});
