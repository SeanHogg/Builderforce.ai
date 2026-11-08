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
 *   live    → the directory's `watch` (the web's webcontainer VFS), as a Live overlay — the
 *             directory is the one a review opened this session, or re-opened by a provider's
 *             `reopen` (no picker), so Live runs on a root reviewed in an earlier session.
 *             The reload is `load` itself, with the query the view last loaded the root by
 *   estimate → the plan's model calls × the host's `callPrice` port (none ⇒ calls only)
 *   syncStatus → server counts from the graph, local from the open directory, skipped from
 *             the client; source states from the badges the graph carries (`syncStatus.ts`).
 *   pinpoint → when the host passes `pinpoint` (vision + catalogs): the shared matching core
 *             over a literal scan of the open directory, else the server search (`pinpoint.ts`).
 *             No `history`/`applyFix`: the browser has no git and no shell, so the view hides those controls
 *
 * The host supplies the client (built on ITS authenticated fetch), where it can review
 * from (`directorySources`), its worker when its bundler needs one, and its reporter.
 * The confirm handshake is the view's (`@builderforce/knowledge-graph-view` `types.ts`):
 * this yields the plan, awaits `ctl.confirm`, and only then reviews.
 */

import { factKeyOf, type DirectorySource, type KnowledgeGraph, type NodeRef, type ReviewReport } from '@seanhogg/builderforce-memory/knowledge';
import {
  KNOWLEDGE_REVIEW_MODEL_CALLS, createReviewRecorder, currentSourcesOf, dirtyFileName, factRightsCache, humanFactBatch,
  type PumpSource, type SkippedFolder,
} from '@builderforce/agent-tools/knowledge';
import type { KnowledgeClient, KnowledgeScopeRecord } from '@builderforce/knowledge-client';
import type { KnowledgeGraphSource, KnowledgeReviewEvent, ReviewControl, ReviewRequest, ReviewTarget } from '@builderforce/knowledge-graph-view';
import { openBrowserKnowledge, type BrowserKnowledge } from './browserKnowledge';
import { createBrowserReplica } from './browserReplica';
import { runReview, type WorkerFactory } from './reviewWorkerClient';
import type { ReviewPorts } from './reviewJob';
import { watchDirectory } from './liveWatch';
import { estimateReview, type CallPricePort } from './reviewEstimate';
import { rootKindOf, type KnowledgeDegradedReporter } from './directorySourceKit';
import { browserSyncStatus, localCountsOf, reviewRecords } from './syncStatus';
import { pinpointImage, type PinpointHost } from './pinpoint';
import { lastSeenMemory } from './lastSeen';

/** The widest graph the platform builds; the sync counts read it. */
const SYNC_MAX_NODES = 2000;
/** How long a finished review waits for its pack to reach the server before it reports `done` (the pump goes on in the background). */
const REPLICA_DRAIN_MS = 120_000;

/** The browser source: the view's port, plus the end of its life (stops the replica pumps and closes the local database). */
export type BrowserKnowledgeSource = KnowledgeGraphSource & { dispose(): Promise<void> };

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
  /** The price of one judgement call, for the confirm chip's cost (the web and Rovr pass the
   *  server's `client.judgeEstimate`). Absent ⇒ the chip shows calls only. */
  callPrice?: CallPricePort;
  /** Where a degraded path (no targets, no manifest, a missed live refresh) is reported. */
  onDegraded: KnowledgeDegradedReporter;
  /** Pinpoint from a screenshot: the host's vision call and catalogs. Absent => the source offers no pinpoint. */
  pinpoint?: PinpointHost;
}

export function createKnowledgeSource(opts: KnowledgeSourceOptions): BrowserKnowledgeSource {
  const { client, onDegraded } = opts;
  /** ONE replica host per source: the review's local store is replicated to the project by ONE pack per root (the pump). */
  const replica = createBrowserReplica(onDegraded);
  const { host } = replica;
  /** The local store, manifest and queue files: opened on first need (IndexedDB, else memory). */
  let localKnowledge: Promise<BrowserKnowledge> | undefined;
  const knowledge = (): Promise<BrowserKnowledge> => (localKnowledge ??= openBrowserKnowledge(onDegraded));
  const pumpOf = (kn: BrowserKnowledge, rootId: string): PumpSource => ({
    rootId, files: kn.files, local: kn.store, client, projectId: opts.projectId, manifest: kn.manifest,
  });
  let resumed = false;
  /** The queues this browser left bound to the project: the pump picks them up again. A root never reviewed here has no queue file. */
  const resumeQueues = async (rootIds: readonly string[]): Promise<void> => {
    const kn = await knowledge();
    for (const rootId of rootIds) {
      if (await kn.files.read(dirtyFileName(rootId))) await host.resumeReplica(pumpOf(kn, rootId));
    }
  };
  /**
   * A root this host holds no rows for, or whose rows cannot outlive the page, must never make the pump delete server data:
   *  - the in-memory fallback is empty after every reload;
   *  - a root reviewed against the server before the local store existed has manifest entries but NO scope here, so an
   *    incremental review would leave only the changed files locally (the server's copy seeds the unchanged ones through readThrough).
   */
  const needsAdditive = async (kn: BrowserKnowledge, rootId: string): Promise<boolean> => {
    if (kn.degraded) return true;
    if ((await kn.store.scopes()).some((s) => s.rootId === rootId)) return false;
    return (await currentSourcesOf(kn.manifest, rootId)).length > 0;
  };
  /** Every directory a review opened this session: a re-review (Continue) reuses its handle, and Live watches those that can. */
  const opened = new Map<string, DirectorySource>();
  /** Per root, the paths changed since its last review (Live's badges), kept across re-subscribes. */
  const pendingChanges = new Map<string, Set<string>>();
  /** Per root, how the view last loaded it: the query Live's reload repeats. */
  const loadedBy = new Map<string, Parameters<KnowledgeGraphSource['load']>[1]>();
  const scopeRecords = new Map<string, KnowledgeScopeRecord>();
  const rights = factRightsCache((rootId) => client.facts(rootId));
  /** What this project showed last (in memory, per page life): the view's first frame. */
  const seen = lastSeenMemory(opts.projectId);
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
  let providersReady: Promise<DirectoryProvider[]> = loadProviders();

  /** The provider that PICKED this root's kind of folder (an upload, a File System Access folder): it cannot re-read it, only ask again. */
  const pickerFor = (rootId: string): DirectoryProvider | undefined => {
    const kind = rootKindOf(rootId);
    return providers.find((p) => p.kind === kind && !p.reopen);
  };

  /** Synchronous up to the provider's `open` — the gesture must still be live there. */
  const openFor = (req: ReviewRequest): Promise<DirectorySource | null> => {
    if (req.target) return providers.find((p) => p.id === req.target)?.open() ?? Promise.resolve(null);
    if (req.rootId) {
      const known = opened.get(req.rootId);
      if (known) return Promise.resolve(known);
      // Not opened this session: a picked folder (an upload, a File System Access folder)
      // cannot be re-read without the person picking it again — its provider has no `reopen`.
      const repick = pickerFor(req.rootId);
      if (repick) return repick.open();
      return reopenRoot(req.rootId);
    }
    const fallback = providers.find((p) => p.kind === 'folder') ?? providers.find((p) => p.kind === 'upload') ?? providers[0];
    return fallback?.open() ?? Promise.resolve(null);
  };

  const changedFor = (rootId: string): Set<string> => {
    let changed = pendingChanges.get(rootId);
    if (!changed) { changed = new Set(); pendingChanges.set(rootId, changed); }
    return changed;
  };

  /** THE read of a root's graph: the view's `load`, and Live's reload of the same root. */
  // The web has no local tree to be "not reviewed" on, so it never answers `NotReviewedHere`: its type is the narrower one.
  const load = async (rootId: string, q?: Parameters<KnowledgeGraphSource['load']>[1]): Promise<KnowledgeGraph | null> => {
    lastRoot = rootId;
    loadedBy.set(rootId, q);
    const graph = await client.graph(rootId, { ...(q?.focus ? { focus: q.focus } : {}), ...(q?.maxNodes ? { maxNodes: q.maxNodes } : {}) });
    rights.loaded(rootId, graph?.scope.digest);
    seen.loaded(rootId, graph, !!q?.focus?.length);
    return graph;
  };

  /** A root a provider can re-read without a picker (the workspace VFS, a drive), or null. */
  const reopenRoot = async (rootId: string): Promise<DirectorySource | null> => {
    for (const p of providers) {
      const dir = p.reopen ? await p.reopen(rootId).catch((error: unknown) => { onDegraded('reopen root', error, { rootId }); return null; }) : null;
      if (dir) return dir;
    }
    return null;
  };

  async function* run(opening: Promise<DirectorySource | null>, req: ReviewRequest, ctl: ReviewControl): AsyncGenerator<KnowledgeReviewEvent> {
    const dir = await opening;
    if (!dir) { yield { type: 'cancelled' }; return; }
    opened.set(dir.rootId, dir);
    const kn = await knowledge();
    const pump = pumpOf(kn, dir.rootId);
    if (await needsAdditive(kn, dir.rootId)) await host.markAdditive(dir.rootId, kn.files);
    // The review writes the LOCAL store; the replicated store queues what changed, and the pump sends it as ONE pack.
    const ports: ReviewPorts = { source: dir, store: host.replicatedStoreOf(dir.rootId, kn.files, kn.store, pump, true), judgement: client.judgement, manifest: kn.manifest };
    const base = { force: !!req.force, modelCalls: KNOWLEDGE_REVIEW_MODEL_CALLS };
    const workerOpts = opts.createWorker ? { createWorker: opts.createWorker } : {};
    const plan = await runReview({ ...base, mode: 'plan' }, ports, workerOpts);
    const estimate = await estimateReview(plan, opts.callPrice, onDegraded);
    // What this review leaves out is recorded per root (plan counts and skips, uploads skipped DURING it) for the sync status.
    const recorder = createReviewRecorder({
      rootId: dir.rootId, store: reviewRecords, client,
      folders: () => (dir as { skippedFolders?: () => SkippedFolder[] }).skippedFolders?.() ?? [],
    });
    recorder.planned(plan);
    yield { type: 'plan', plan, estimate };
    if (!(await ctl.confirm(plan, estimate))) { yield { type: 'cancelled' }; return; }
    recorder.begin();

    const queue: Array<KnowledgeReviewEvent | { type: 'failed'; error: unknown }> = [];
    let wake: (() => void) | null = null;
    const push = (e: (typeof queue)[number]) => { queue.push(e); wake?.(); };
    const review = (): Promise<ReviewReport> => runReview({ ...base, mode: 'review' }, ports, { ...workerOpts, signal: ctl.signal, onProgress: (progress) => push({ type: 'progress', progress }) });
    // One batch per review, as the editor's: the local store persists in checkpoints, not once per file.
    const batched = (): Promise<ReviewReport> => (ports.store.batched ? ports.store.batched(review) : review());
    void (async () => {
      const report = await replica.duringReview(dir.rootId, kn.files, pump, batched, { full: !!req.force });
      // The result is on the server when `done` is shown (the graph is server-built); a pump still sending after the wait goes on in the background.
      await host.drainedWithin(dir.rootId, REPLICA_DRAIN_MS).catch((error: unknown) => { onDegraded('replica drain', error, { rootId: dir.rootId }); });
      // The new review IS the files' current state: nothing is pending against it.
      pendingChanges.get(dir.rootId)?.clear();
      recorder.finish();
      const skipped = reviewRecords.get(dir.rootId)?.skipped;
      push({ type: 'done', rootId: dir.rootId, report, ...(skipped ? { skipped } : {}) });
    })().catch((error: unknown) => push({ type: 'failed', error }));
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
      const found = records.map((r) => ({ rootId: r.rootId, title: r.title, packs: r.packs, ...(r.lastReviewedAt ? { lastReviewedAt: r.lastReviewedAt } : {}) }));
      seen.scopes(found);
      return found;
    },
    load,
    lastSeen: seen.read,
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
      providersReady = loadProviders();
      const list = await providersReady;
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
      // A root reviewed in an EARLIER session is not in `opened`: its provider re-opens it
      // (the workspace VFS, a drive) without a picker. A directory without `watch` (a picked
      // folder, even one a review opened this session) is never subscribed.
      let cancelled = false;
      let stop: () => void = () => undefined;
      void (async () => {
        await providersReady;
        let dir = opened.get(rootId) ?? null;
        if (!dir) {
          dir = await reopenRoot(rootId);
          // The host may have lost the handle along with its providers: list them again ONCE and
          // retry — but only for a root some provider could re-open (not a picked folder).
          if (!dir && !cancelled && !pickerFor(rootId) && providers.some((p) => p.reopen)) {
            providersReady = loadProviders();
            await providersReady;
            if (!cancelled) dir = await reopenRoot(rootId);
          }
          if (dir) opened.set(rootId, dir);
        }
        // Still nothing, or a directory that cannot watch (a picked folder): stop here, quietly.
        // No loop, no watcher.
        if (cancelled || !dir?.watch) return;
        stop = watchDirectory(dir, rootId, cb, { graph: (id) => load(id, loadedBy.get(id)), changed: changedFor(rootId), onDegraded });
      })().catch((error: unknown) => onDegraded('live subscribe', error, { rootId }));
      return () => { cancelled = true; stop(); };
    },
    async rememberFact({ content, ref, rootId }) {
      const scope = scopeRecords.get(rootId) ?? { rootId, title: rootId, packs: [] };
      await client.store.write(humanFactBatch({ scope, ref, content }));
      rights.invalidate(rootId);
    },
    ...(opts.pinpoint ? {
      pinpoint: (image: Blob, rootId: string) => pinpointImage({
        client,
        host: opts.pinpoint!,
        directory: async (id) => opened.get(id) ?? (await reopenRoot(id)),
        graph: (id) => client.graph(id, { maxNodes: SYNC_MAX_NODES }),
      }, image, rootId),
    } : {}),
    async syncStatus(rootId) {
      const graph = await client.graph(rootId, { maxNodes: SYNC_MAX_NODES });
      return browserSyncStatus({ graph, record: reviewRecords.get(rootId) });
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
