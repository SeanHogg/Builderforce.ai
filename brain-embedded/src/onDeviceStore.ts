/**
 * The HOST-FACING loader for the on-device answer store — the piece that binds
 * {@link OnDeviceAnswerStore} to a real SSM runtime.
 *
 * WHY THIS MOVED HERE. The store builder was `frontend/src/lib/semantic-cache.ts`, which
 * meant only the web app could reach it: Rovr (Chrome, WebGPU) was locked out of a tier
 * it could run, and the only sane next step — a Node WebGPU store for the editor — was
 * impossible while the builder sat behind the frontend's `@/` alias. Nothing in it is
 * host-specific: `SSM` + `SemanticCache` are the same classes everywhere.
 *
 * TWO THINGS THIS GETS RIGHT THAT THE SINGLE GLOBAL CACHE DID NOT.
 *
 * 1. **The store is partitioned by scope.** The store used to be memoised under one
 *    global key, so a near-identical question asked in project B could replay an answer
 *    cached from project A — and "which tickets are in the backlog?" is the case where
 *    that hurts most, because it matches itself across every board. Each scope now gets
 *    its OWN `SemanticCache` instance, so partitioning is by construction rather than by
 *    a key somebody has to remember to pass.
 *
 * 2. **The EXPENSIVE half is shared, the CHEAP half is partitioned.** The SSM runtime
 *    (model assets, a worker) is memoised ONCE per tab and its `embed` is handed to every
 *    per-scope cache. Partitioning costs one empty array per scope, not one model load
 *    per scope — the naive "key the whole builder by project" fix would have loaded the
 *    embedder once per project the person ever opened.
 *
 * Gracefully optional, same contract as before: no WebGPU, no SSM assets, or a runtime
 * that cannot spawn a worker ⇒ `null` forever, and the loop falls through to the server
 * tier. Nothing here throws.
 */

import { hasWebGPU } from './pageEngines/webgpu';
import { ON_DEVICE_ANSWER_THRESHOLD, type OnDeviceAnswerStore } from './onDeviceMemory';

/**
 * The scope a store is partitioned by. A project id is the normal case; a host that has
 * no project (a signed-out surface) passes its own stable token so its answers still
 * never land in a project's partition.
 */
export type OnDeviceStoreScope = string | number;

/** The embedder every per-scope cache shares — loaded once, null when unavailable. */
type Embedder = (text: string) => Promise<Float32Array>;

let embedder: Promise<Embedder | null> | null = null;

/**
 * One SSM runtime for the tab. Memoised so a second scope does not reload the model.
 *
 * A FAILED load is deliberately NOT memoised. The embedder fails for transient reasons
 * (assets still downloading, the worker not yet spawnable, a tab that lost its GPU and
 * got it back), and pinning that failure would turn one bad moment into "on-device
 * memory is off for the rest of this tab". The next question — same scope or another —
 * gets a fresh attempt. A device with no WebGPU at all never starts a load.
 */
function sharedEmbedder(): Promise<Embedder | null> {
  if (embedder) return embedder;
  const attempt = (async () => {
    if (!hasWebGPU()) return null;
    const mod = await import('@seanhogg/builderforce-memory');
    // Browser uses the global WebGPU/IndexedDB automatically; modelSize keeps the
    // embedding model light. Asset/WebGPU failures throw → caught → null.
    const runtime = await mod.SSM.create({ session: { modelSize: 'small' } });
    return (text: string) => runtime.embed(text);
  })().catch((err) => {
    // Drop the memoised promise so the next question retries rather than inheriting
    // a transient failure for the rest of the tab.
    if (embedder === attempt) embedder = null;
    console.warn('[on-device-store] unavailable — on-device memory off:', err);
    return null;
  });
  embedder = attempt;
  return attempt;
}

const stores = new Map<OnDeviceStoreScope, Promise<OnDeviceAnswerStore | null>>();

/**
 * The on-device answer store for ONE scope, memoised per scope for the life of the tab.
 *
 * Returns null — never throws — when the device cannot run the embedder, so a caller can
 * hand the result straight to `onDeviceMemoryHooks`. Two scopes never share entries: each
 * gets its own `SemanticCache`, whose entries live in an in-process array and die with
 * the tab. There is deliberately no L2 here — a shared backend would put a server back
 * into a tier whose whole point is answering without one, and would duplicate the
 * server-side Q&A cache the Brain already consults on the next tier down.
 */
export function loadOnDeviceAnswerStore(scope: OnDeviceStoreScope): Promise<OnDeviceAnswerStore | null> {
  if (!hasWebGPU()) return Promise.resolve(null);
  const existing = stores.get(scope);
  if (existing) return existing;
  const built = (async () => {
    const embed = await sharedEmbedder();
    if (!embed) return null;
    const mod = await import('@seanhogg/builderforce-memory');
    return new mod.SemanticCache({
      embed,
      threshold: ON_DEVICE_ANSWER_THRESHOLD,
      ttlMs: 24 * 60 * 60 * 1_000,
    });
  })().catch((err) => {
    console.warn('[on-device-store] unavailable — on-device memory off:', err);
    return null;
  });
  // Pin a store only when one was built. A null is a failed load, and pinning it would
  // make the next question in this project skip the retry the embedder itself allows.
  stores.set(scope, built);
  void built.then((store) => {
    if (store == null) stores.delete(scope);
  });
  return built;
}

/** Drop every memoised store and the shared embedder — tests only. */
export function resetOnDeviceStoresForTests(): void {
  stores.clear();
  embedder = null;
}
