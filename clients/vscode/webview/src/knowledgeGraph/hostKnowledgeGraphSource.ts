/**
 * The editor's `KnowledgeGraphSource` (PRD 38 §4.6–4.7, VS Code row): the view's ONE port,
 * answered by the extension host — the review runs and the graph is built THERE
 * (`src/knowledge/knowledgeBridge.ts`); this side only messages it
 * (`src/knowledge/knowledgeProtocol.ts`).
 *
 * The review confirm handshake (`@builderforce/knowledge-graph-view` `types.ts`):
 *   1. `plan` — the host picks the folder (a known root, a workspace folder, or its folder
 *      picker) and plans it; nothing is written. No folder ⇒ `cancelled`. The call answers at
 *      once and the plan arrives as a `planned` event on a stream this side opened first
 *      (a big folder, or a picker left open, outlives any request timeout). Stop while
 *      planning ends the wait and discards the session when the plan lands.
 *   2. yield the plan; await `ctl.confirm`. Cancel / *Re-review all* ⇒ `discard`, `cancelled`.
 *   3. `run` — the host starts the review on that plan; its progress and its report arrive as
 *      `knowledge.event`s on the review's stream (a review outlives any request timeout).
 *   4. `ctl.signal` (Stop) ⇒ `stop`: the review aborts between files; what was written stays.
 *
 * Pure over {@link KnowledgeTransport} (the bridge's is `knowledgeTransport.ts`), so the
 * handshake is tested without a webview.
 */

import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { blobDataUrl, checkPinpointImage, rootIdOfSourceRef } from '@builderforce/agent-tools/knowledge';
import { ReviewFailure } from '@builderforce/knowledge-graph-view';
import type {
  KnowledgeBaseline, KnowledgeGraphSource, KnowledgeReviewEvent, KnowledgeScopeSummary, KnowledgeSearchHit, PinpointResult,
  ReviewControl, ReviewRequest, ReviewTarget, SyncStatus,
} from '@builderforce/knowledge-graph-view';
import type {
  KnowledgeCall, KnowledgeEvent, KnowledgeFixResult, KnowledgeHistoryResult, KnowledgePlanReply, KnowledgeTargetRow,
} from '../../../src/knowledge/knowledgeProtocol';

export interface KnowledgeTransport {
  call<T>(call: KnowledgeCall): Promise<T>;
  /** Every `knowledge.event`; returns the unsubscribe. */
  onEvent(cb: (event: KnowledgeEvent) => void): () => void;
}

export interface HostKnowledgeSourceOptions {
  /** Marks the files changed since the graph was built (the shared Live overlay). */
  overlay?(graph: KnowledgeGraph, changed: readonly string[]): KnowledgeGraph;
  /** True when a review starts, false when it ends however it ends (planning, confirm and run included). Reviews may overlap: count them with {@link reviewCount}. */
  onReviewActive?(active: boolean): void;
}

/** How long, after Stop, the review waits for the host's terminal event before letting go. */
export const ABORT_GRACE_MS = 30_000;

/** The live-review count after one review starts (`active`) or ends: overlapping reviews hold the flag until the LAST ends. */
export const reviewCount = (count: number, active: boolean): number => Math.max(0, count + (active ? 1 : -1));

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

type FailedEvent = Extract<KnowledgeEvent, { type: 'failed' }>;

const failureOf = (e: FailedEvent): ReviewFailure => new ReviewFailure(e.error, {
  ...(e.detail ? { detail: e.detail } : {}), ...(e.host ? { host: e.host } : {}), ...(e.rootPath ? { rootPath: e.rootPath } : {}),
});

/**
 * Asks the host to plan and waits for the `planned` event. The stream is subscribed BEFORE the
 * call so the answer cannot be missed. Resolves `'aborted'` when `signal` fires first; the
 * host's session is then discarded as soon as its plan lands.
 */
async function planOverStream(t: KnowledgeTransport, req: ReviewRequest, signal: AbortSignal): Promise<KnowledgePlanReply | 'aborted'> {
  const stream = nextStream('review');
  const events = streamOf(t, stream);
  let abandoned = false;
  try {
    await t.call({ op: 'plan', req, stream });
    const landed = events.next();
    let onAbort = (): void => undefined;
    const aborted = new Promise<'aborted'>((resolve) => {
      onAbort = () => resolve('aborted');
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    });
    const first = await Promise.race([landed, aborted]);
    signal.removeEventListener('abort', onAbort);
    const discardWhenLanded = (e: KnowledgeEvent): void => {
      if (e.type === 'planned' && 'reviewId' in e.reply) void t.call({ op: 'discard', reviewId: e.reply.reviewId }).catch(() => undefined);
    };
    if (first === 'aborted') {
      abandoned = true;
      void landed.then(discardWhenLanded).finally(events.close);
      return 'aborted';
    }
    if (first.type === 'failed') throw failureOf(first);
    if (first.type !== 'planned') throw new Error('knowledge: the plan answered with an unexpected event');
    if (signal.aborted) { discardWhenLanded(first); return 'aborted'; }
    return first.reply;
  } finally {
    if (!abandoned) events.close();
  }
}

export function createHostKnowledgeGraphSource(t: KnowledgeTransport, opts: HostKnowledgeSourceOptions = {}): KnowledgeGraphSource {
  async function* review(req: ReviewRequest, ctl: ReviewControl): AsyncGenerator<KnowledgeReviewEvent> {
    opts.onReviewActive?.(true);
    try {
      yield* reviewFlow(req, ctl);
    } finally {
      opts.onReviewActive?.(false);
    }
  }

  async function* reviewFlow(req: ReviewRequest, ctl: ReviewControl): AsyncGenerator<KnowledgeReviewEvent> {
    const reply = await planOverStream(t, req, ctl.signal);
    // Stop while planning: the consumer already marked the run aborted, so end quietly.
    if (reply === 'aborted') return;
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
    // After Stop the host still owes a terminal event (its `done` carries what was written), but a
    // host that never sends one must not hold the panel: the wait is bounded by the grace period.
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let expire = (): void => undefined;
    const expired = new Promise<'expired'>((resolve) => { expire = () => resolve('expired'); });
    const stop = (): void => {
      void t.call({ op: 'stop', reviewId }).catch(() => undefined);
      graceTimer ??= setTimeout(expire, ABORT_GRACE_MS);
    };
    ctl.signal.addEventListener('abort', stop, { once: true });
    try {
      const started = await t.call<{ started: boolean }>({ op: 'run', reviewId });
      if (!started.started) throw new Error('knowledge: the review could not start');
      if (ctl.signal.aborted && graceTimer === undefined) stop();
      for (;;) {
        const e = await Promise.race([events.next(), expired]);
        if (e === 'expired') return;
        if (e.type === 'progress') yield { type: 'progress', progress: e.progress };
        else if (e.type === 'done') { yield { type: 'done', rootId: e.rootId, report: e.report, ...(e.skipped ? { skipped: e.skipped } : {}) }; return; }
        else if (e.type === 'failed') throw failureOf(e);
      }
    } finally {
      events.close();
      clearTimeout(graceTimer);
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
    async pinpoint(image: Blob, rootId: string): Promise<PinpointResult> {
      checkPinpointImage(image);
      return t.call<PinpointResult>({ op: 'pinpoint', rootId, image: await blobDataUrl(image) });
    },
    history: (rootId: string) => t.call<KnowledgeHistoryResult>({ op: 'history', rootId }),
    syncStatus: (rootId: string) => t.call<SyncStatus>({ op: 'syncStatus', rootId }),
    applyFix(finding: Finding): Promise<KnowledgeFixResult> {
      const source = finding.nodes.find((ref) => rootIdOfSourceRef(ref) !== undefined);
      const rootId = source ? rootIdOfSourceRef(source) : undefined;
      if (!rootId) return Promise.reject(new Error('knowledge: the finding names no source of a root'));
      return t.call<KnowledgeFixResult>({ op: 'applyFix', rootId, finding });
    },
  };
}
