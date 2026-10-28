/**
 * THE browser `KnowledgeGraphSource` (PRD 38 §4.7, web and Rovr rows). Ports only:
 *
 *   scopes · graph · search · deleteFact  → the knowledge API client (server-built graph)
 *   factActions → the facts endpoint's `viewer` + `createdBy`, read once per graph version
 *             (agent-tools `factRightsCache` — the server's delete rule, one copy)
 *   baseline → the root's previous review, server-built at its stored digest
 *             (`graph(root, { at: previousDigest })`) — the same "before" on every host
 *   review  → memory's planReview/reviewDirectory in a Web Worker, with `client.store` as
 *             the KnowledgeStore, `client.judgement` as the JudgementPort, the shared pack
 *             list and an IndexedDB manifest per root (`reviewWorkerClient.ts`)
 *   live    → the directory's `watch` (the web's webcontainer VFS), as a Live overlay
 *
 * The host supplies the client (built on ITS authenticated fetch), where it can review
 * from (`directorySources`), its worker when its bundler needs one, and its reporter.
 * The confirm handshake is the view's (`@builderforce/knowledge-graph-view` `types.ts`):
 * this yields the plan, awaits `ctl.confirm`, and only then reviews.
 */

import { factKeyOf, type DirectorySource, type KnowledgeGraph, type NodeRef, type ReviewReport } from '@seanhogg/builderforce-memory/knowledge';
import { KNOWLEDGE_REVIEW_MODEL_CALLS, factRightsCache, humanFactBatch } from '@builderforce/agent-tools/knowledge';
import type { KnowledgeClient, KnowledgeScopeRecord } from '@builderforce/knowledge-client';
import type { KnowledgeGraphSource, KnowledgeReviewEvent, ReviewControl, ReviewRequest, ReviewTarget } from '@builderforce/knowledge-graph-view';
import { openManifest } from './manifestStore';
import { runReview, type WorkerFactory } from './reviewWorkerClient';
import type { ReviewPorts } from './reviewJob';
import { applyLiveOverlay } from './liveOverlay';
import { rootKindOf, type KnowledgeDegradedReporter } from './directorySourceKit';

/** One way a host can get a directory: its workspace, a folder upload or picker, a drive. */
export interface DirectoryProvider {
  id: string;
  kind: ReviewTarget['kind'];
  title?: string;
  /** Called SYNCHRONOUSLY inside the user's gesture (a folder dialog needs it). Null = cancelled. */
  open(): Promise<DirectorySource | null>;
  /** Re-opens a root this provider reviewed before, without a picker, when it can. */
  reopen?(rootId: string): Promise<DirectorySource | null>;
}

export interface KnowledgeSourceOptions {
  projectId: number;
  client: KnowledgeClient;
  directorySources: () => Promise<DirectoryProvider[]>;
  createWorker?: WorkerFactory;
  /** Where a degraded path (no targets, no manifest, a missed live refresh) is reported. */
  onDegraded: KnowledgeDegradedReporter;
}

const LIVE_DEBOUNCE_MS = 800;

export function createKnowledgeSource(opts: KnowledgeSourceOptions): KnowledgeGraphSource {
  const { client, onDegraded } = opts;
  const opened = new Map<string, DirectorySource>();
  const scopeRecords = new Map<string, KnowledgeScopeRecord>();
  const rights = factRightsCache((rootId) => client.facts(rootId));
  let providers: DirectoryProvider[] = [];
  /** The root the view last loaded — whose facts a fact action is about. */
  let lastRoot: string | null = null;
  /** The latest scopes listing in flight (or settled), which `baseline` reads after. */
  let scopesListing: Promise<unknown> = Promise.resolve();

  const loadProviders = async () => {
    try {
      providers = await opts.directorySources();
    } catch (error) {
      // No targets: the view offers its plain folder picker instead.
      onDegraded('review targets', error);
      providers = [];
    }
    return providers;
  };
  void loadProviders();

  /** Synchronous up to the provider's `open` — the gesture must still be live there. */
  const openFor = (req: ReviewRequest): Promise<DirectorySource | null> => {
    if (req.target) return providers.find((p) => p.id === req.target)?.open() ?? Promise.resolve(null);
    if (req.rootId) {
      const known = opened.get(req.rootId);
      if (known) return Promise.resolve(known);
      // A picked folder (an upload, a File System Access folder) cannot be re-read
      // without the person picking it again: its provider has no `reopen`.
      const kind = rootKindOf(req.rootId);
      const repick = providers.find((p) => p.kind === kind && !p.reopen);
      if (repick) return repick.open();
      const rootId = req.rootId;
      return (async () => {
        for (const p of providers) {
          const dir = p.reopen ? await p.reopen(rootId).catch((error: unknown) => { onDegraded('reopen root', error, { rootId }); return null; }) : null;
          if (dir) return dir;
        }
        return null;
      })();
    }
    const fallback = providers.find((p) => p.kind === 'folder') ?? providers.find((p) => p.kind === 'upload') ?? providers[0];
    return fallback?.open() ?? Promise.resolve(null);
  };

  async function* run(opening: Promise<DirectorySource | null>, req: ReviewRequest, ctl: ReviewControl): AsyncGenerator<KnowledgeReviewEvent> {
    const dir = await opening;
    if (!dir) { yield { type: 'cancelled' }; return; }
    opened.set(dir.rootId, dir);
    const ports: ReviewPorts = { source: dir, store: client.store, judgement: client.judgement, manifest: await openManifest(dir.rootId, onDegraded) };
    const base = { force: !!req.force, modelCalls: KNOWLEDGE_REVIEW_MODEL_CALLS };
    const workerOpts = opts.createWorker ? { createWorker: opts.createWorker } : {};
    const plan = await runReview({ ...base, mode: 'plan' }, ports, workerOpts);
    yield { type: 'plan', plan };
    if (!(await ctl.confirm(plan))) { yield { type: 'cancelled' }; return; }

    const queue: Array<KnowledgeReviewEvent | { type: 'failed'; error: unknown }> = [];
    let wake: (() => void) | null = null;
    const push = (e: (typeof queue)[number]) => { queue.push(e); wake?.(); };
    void runReview({ ...base, mode: 'review' }, ports, { ...workerOpts, signal: ctl.signal, onProgress: (progress) => push({ type: 'progress', progress }) })
      .then((report: ReviewReport) => push({ type: 'done', rootId: dir.rootId, report }), (error: unknown) => push({ type: 'failed', error }));
    for (;;) {
      while (queue.length > 0) {
        const ev = queue.shift()!;
        if (ev.type === 'failed') throw ev.error;
        yield ev;
        if (ev.type === 'done') return;
      }
      await new Promise<void>((resolve) => { wake = resolve; });
      wake = null;
    }
  }

  return {
    async scopes() {
      const listing = client.scopes();
      scopesListing = listing.catch(() => undefined);
      const records = await listing;
      for (const r of records) scopeRecords.set(r.rootId, r);
      return records.map((r) => ({ rootId: r.rootId, title: r.title, packs: r.packs, ...(r.lastReviewedAt ? { lastReviewedAt: r.lastReviewedAt } : {}) }));
    },
    async load(rootId, q) {
      lastRoot = rootId;
      const graph = await client.graph(rootId, { ...(q?.focus ? { focus: q.focus } : {}), ...(q?.maxNodes ? { maxNodes: q.maxNodes } : {}) });
      rights.loaded(rootId, graph?.scope.digest);
      return graph;
    },
    async baseline(rootId) {
      // The view lists scopes before it loads a root (again after a review, which moves the
      // digests): wait for that listing so "before" is the review before the newest one.
      await scopesListing;
      const at = scopeRecords.get(rootId)?.previousDigest;
      if (!at) return null;
      const graph = await client.graph(rootId, { at });
      return graph ? { graph } : null;
    },
    async targets() {
      const list = await loadProviders();
      return list.map((p) => ({ id: p.id, kind: p.kind, ...(p.title ? { title: p.title } : {}) }));
    },
    review(req, ctl) {
      return run(openFor(req), req, ctl);
    },
    async search(rootId, q) {
      const hits = await client.search(rootId, q);
      return hits.map((h) => ({ ref: h.id, score: h.score, tier: h.tier }));
    },
    subscribeLive(rootId, cb) {
      const dir = opened.get(rootId);
      if (!dir?.watch) return () => undefined;
      const changed = new Set<string>();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const stop = dir.watch((paths) => {
        for (const p of paths) changed.add(p);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void client.graph(rootId).then((g: KnowledgeGraph | null) => { if (g) cb(applyLiveOverlay(g, changed)); })
            .catch((error: unknown) => onDegraded('live refresh', error, { rootId }));
        }, LIVE_DEBOUNCE_MS);
      });
      return () => { if (timer) clearTimeout(timer); stop(); };
    },
    async rememberFact({ content, ref, rootId }) {
      const scope = scopeRecords.get(rootId) ?? { rootId, title: rootId, packs: [] };
      await client.store.write(humanFactBatch({ scope, ref, content }));
      rights.invalidate(rootId);
    },
    async factActions(ref) {
      const key = factKeyOf(ref as NodeRef);
      const rootId = lastRoot;
      if (!key || !rootId) return undefined;
      // Unknown author or a failed read ⇒ no Delete offered; the API enforces it either way.
      const allowed = await rights.canDelete(rootId, key).catch((error: unknown) => { onDegraded('fact rights', error, { rootId }); return false; });
      if (!allowed) return undefined;
      return { delete: async () => { await client.deleteFact(key); rights.invalidate(rootId); } };
    },
  };
}
