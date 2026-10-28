/**
 * The editor's `KnowledgeGraphSource` (PRD 38 §4.6–4.7, VS Code row): the view's ONE port,
 * answered by the extension host — the review runs and the graph is built THERE
 * (`src/knowledge/knowledgeBridge.ts`); this side only messages it
 * (`src/knowledge/knowledgeProtocol.ts`).
 *
 * The review confirm handshake (`@builderforce/knowledge-graph-view` `types.ts`):
 *   1. `plan` — the host picks the folder (a known root, a workspace folder, or its folder
 *      picker) and plans it; nothing is written. No folder ⇒ `cancelled`.
 *   2. yield the plan; await `ctl.confirm`. Cancel / *Re-review all* ⇒ `discard`, `cancelled`.
 *   3. `run` — the host starts the review on that plan; its progress and its report arrive as
 *      `knowledge.event`s on the review's stream (a review outlives any request timeout).
 *   4. `ctl.signal` (Stop) ⇒ `stop`: the review aborts between files; what was written stays.
 *
 * Pure over {@link KnowledgeTransport} (the bridge's is `knowledgeTransport.ts`), so the
 * handshake is tested without a webview.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type {
  KnowledgeBaseline, KnowledgeGraphSource, KnowledgeReviewEvent, KnowledgeScopeSummary, KnowledgeSearchHit, ReviewControl,
  ReviewRequest, ReviewTarget,
} from '@builderforce/knowledge-graph-view';
import type {
  KnowledgeCall, KnowledgeEvent, KnowledgePlanReply, KnowledgeTargetRow,
} from '../../../src/knowledge/knowledgeProtocol';

export interface KnowledgeTransport {
  call<T>(call: KnowledgeCall): Promise<T>;
  /** Every `knowledge.event`; returns the unsubscribe. */
  onEvent(cb: (event: KnowledgeEvent) => void): () => void;
}

export interface HostKnowledgeSourceOptions {
  /** Marks the files changed since the graph was built (the shared Live overlay). */
  overlay?(graph: KnowledgeGraph, changed: readonly string[]): KnowledgeGraph;
}

let streams = 0;
const nextStream = (prefix: string): string => `${prefix}-${++streams}`;

/** Events on one stream, in order, until the consumer stops. */
function streamOf(t: KnowledgeTransport, stream: string) {
  const queue: KnowledgeEvent[] = [];
  let wake: (() => void) | null = null;
  const off = t.onEvent((e) => {
    if (e.stream !== stream) return;
    queue.push(e);
    wake?.();
  });
  return {
    async next(): Promise<KnowledgeEvent> {
      while (queue.length === 0) await new Promise<void>((resolve) => { wake = resolve; });
      wake = null;
      return queue.shift()!;
    },
    close: off,
  };
}

export function createHostKnowledgeGraphSource(t: KnowledgeTransport, opts: HostKnowledgeSourceOptions = {}): KnowledgeGraphSource {
  async function* review(req: ReviewRequest, ctl: ReviewControl): AsyncGenerator<KnowledgeReviewEvent> {
    const reply = await t.call<KnowledgePlanReply>({ op: 'plan', req });
    if ('cancelled' in reply) { yield { type: 'cancelled' }; return; }
    const { reviewId, plan } = reply;
    yield { type: 'plan', plan };
    if (!(await ctl.confirm(plan))) {
      void t.call({ op: 'discard', reviewId }).catch(() => undefined);
      yield { type: 'cancelled' };
      return;
    }
    // Subscribed BEFORE the run starts: its first progress can beat the call's answer.
    const events = streamOf(t, reviewId);
    const stop = (): void => { void t.call({ op: 'stop', reviewId }).catch(() => undefined); };
    ctl.signal.addEventListener('abort', stop, { once: true });
    try {
      const started = await t.call<{ started: boolean }>({ op: 'run', reviewId });
      if (!started.started) throw new Error('knowledge: the review could not start');
      if (ctl.signal.aborted) stop();
      for (;;) {
        const e = await events.next();
        if (e.type === 'progress') yield { type: 'progress', progress: e.progress };
        else if (e.type === 'done') { yield { type: 'done', rootId: e.rootId, report: e.report }; return; }
        else if (e.type === 'failed') throw new Error(e.error);
      }
    } finally {
      events.close();
      ctl.signal.removeEventListener('abort', stop);
    }
  }

  return {
    scopes: () => t.call<KnowledgeScopeSummary[]>({ op: 'scopes' }),
    load: (rootId, q) => t.call<KnowledgeGraph | null>({
      op: 'load', rootId, ...(q?.focus ? { focus: q.focus } : {}), ...(q?.maxNodes ? { maxNodes: q.maxNodes } : {}),
    }),
    async targets(): Promise<ReviewTarget[]> {
      const rows = await t.call<KnowledgeTargetRow[]>({ op: 'targets' });
      return rows.map((r) => ({ id: r.id, kind: r.kind, ...(r.title ? { title: r.title } : {}) }));
    },
    review: (req, ctl) => review(req, ctl),
    search: (rootId, q) => t.call<KnowledgeSearchHit[]>({ op: 'search', rootId, q }),
    subscribeLive(rootId, cb) {
      const stream = nextStream('live');
      const off = t.onEvent((e) => {
        if (e.stream !== stream || e.type !== 'graph') return;
        cb(opts.overlay ? opts.overlay(e.graph, e.changed) : e.graph);
      });
      void t.call({ op: 'live', rootId, stream }).catch(() => undefined);
      return () => {
        off();
        void t.call({ op: 'unlive', stream }).catch(() => undefined);
      };
    },
    async rememberFact({ content, ref, rootId }) {
      await t.call({ op: 'remember', rootId, ref, content });
    },
    async factActions(ref) {
      const { canDelete } = await t.call<{ canDelete: boolean }>({ op: 'factActions', ref });
      return canDelete ? { delete: async () => { await t.call({ op: 'deleteFact', ref }); } } : undefined;
    },
    baseline: (rootId) => t.call<KnowledgeBaseline | null>({ op: 'baseline', rootId }),
  };
}
