'use client';

/**
 * Learned Model Routing (PRD 13 §6.6) — CLIENT-SIDE SSM recall bias.
 *
 * The heavy semantic recall runs on the USER's machine (zero server cost): embed the
 * task → kNN over this browser's locally-held `(task → winning_model, score)` memories
 * → a small `routingBias: { model: weight }` map the server merges as a NUDGE over the
 * shared KV routing table. Strictly personalization on top of the authoritative table:
 * headless runs (and WebGPU-absent clients) simply omit it and route on the table alone.
 *
 * Placement per §4.1: IndexedDB-backed (weights/memories are binary-ish + larger than
 * LocalStorage's ~5 MB synchronous string cap); compute gated behind a capability check
 * + the kill switch; absent → an empty map (a no-op, identical to Phase 2).
 *
 * The embedding seam (`embedTask`) is deliberately pluggable: today it is a fast,
 * deterministic in-browser feature hash (real + zero-dependency), and a MambaKit/SSMjs
 * WebGPU SSM embedding is a drop-in replacement behind the SAME function once the
 * per-codebase `model.bin` weights are pushed (see the Gap Register).
 */

const DB_NAME = 'bf-model-recall';
const STORE = 'memories';
const DB_VERSION = 1;
/** How many top-similar memories vote on the bias. */
const KNN_K = 8;
/** Only memories at least this cosine-similar to the task contribute. */
const SIM_THRESHOLD = 0.25;
/** Max magnitude of a single model's nudge (the server also clamps to ±1). */
const MAX_BIAS = 0.15;
const EMBED_DIM = 256;

export interface OutcomeMemory {
  /** Stable key (executionId) so re-recording an outcome updates in place. */
  id: string;
  taskText: string;
  embedding: number[];
  model: string;
  score: number;
  createdAt: number;
}

/** Feature-hash embedding of a task's text — deterministic, L2-normalized, runs
 *  in-browser with no model/weights. Swapped for a MambaKit SSM embedding behind this
 *  same signature once codebase weights are available. */
export function embedTask(text: string): number[] {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % EMBED_DIM;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both are L2-normalized → dot product is cosine similarity.
}

/** WebGPU present? The capability gate per §4.1 (compute moves to the client GPU when
 *  it can; this is also a proxy for "a real browser tab", so headless never runs it). */
export function hasRecallCapability(): boolean {
  if (typeof navigator === 'undefined' || typeof indexedDB === 'undefined') return false;
  return 'gpu' in navigator && (navigator as { gpu?: unknown }).gpu != null;
}

/** Kill switch — mirror the server's `LEARNED_ROUTING_ENABLED`. A tenant/user can set
 *  `localStorage['bf.learnedRouting'] = '0'` to opt out client-side. Default on. */
function recallEnabled(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem('bf.learnedRouting') !== '0';
  } catch {
    return true;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Persist one outcome into local recall memory (called when a run the user is viewing
 * is scored — directly, or via the WS outcome push). Idempotent on `id` (executionId).
 * Best-effort; a storage failure just means no local recall for that run.
 */
export async function recordOutcomeMemory(m: { id: string | number; taskText: string; model: string; score: number }): Promise<void> {
  if (!recallEnabled() || typeof indexedDB === 'undefined' || !m.model) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const entry: OutcomeMemory = {
      id: String(m.id),
      taskText: m.taskText,
      embedding: embedTask(m.taskText),
      model: m.model,
      score: m.score,
      createdAt: Date.now(),
    };
    tx.objectStore(STORE).put(entry);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Best-effort.
  }
}

/**
 * Warm the local recall memory from the tenant's recently-scored outcomes (fetched
 * via `/llm/v1/recall-seed`). Called once when an interactive surface mounts so a
 * fresh device/session has memory to bias from instead of relearning from scratch.
 * Capability/kill-switch gated and best-effort. `fetcher` is injected so this lib
 * stays free of an api-client import cycle.
 */
export async function seedModelRecallMemory(
  fetcher: () => Promise<Array<{ id: string | number; taskText: string; model: string; score: number }>>,
): Promise<void> {
  if (!recallEnabled() || !hasRecallCapability()) return;
  try {
    const memories = await fetcher();
    for (const m of memories) await recordOutcomeMemory(m);
  } catch {
    // Best-effort — no seed just means recall warms up as runs complete.
  }
}

/**
 * Compute the SSM recall bias for a task: embed it, kNN over local memories, and let
 * each similar prior run vote for its winning model weighted by similarity × score.
 * Returns an empty map (a no-op) when the capability/kill-switch gate fails or there is
 * no relevant memory — so an interactive run with no recall behaves exactly like a
 * headless one. Never throws.
 */
export async function computeModelRecallBias(taskText: string): Promise<Record<string, number>> {
  if (!recallEnabled() || !hasRecallCapability() || !taskText.trim()) return {};
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const all = (await idbReq(tx.objectStore(STORE).getAll())) as OutcomeMemory[];
    db.close();
    if (!all || all.length === 0) return {};

    const q = embedTask(taskText);
    const scored = all
      .map((m) => ({ m, sim: cosine(q, m.embedding) }))
      .filter((x) => x.sim >= SIM_THRESHOLD)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, KNN_K);
    if (scored.length === 0) return {};

    // Each neighbour nudges its winning model by sim × score; accumulate then clamp.
    const raw: Record<string, number> = {};
    for (const { m, sim } of scored) raw[m.model] = (raw[m.model] ?? 0) + sim * m.score;

    // Normalize so the strongest signal lands at MAX_BIAS (a nudge, never a takeover).
    const peak = Math.max(...Object.values(raw), 1e-9);
    const bias: Record<string, number> = {};
    for (const [model, w] of Object.entries(raw)) {
      const nudge = (w / peak) * MAX_BIAS;
      if (Math.abs(nudge) >= 0.001) bias[model] = Math.round(nudge * 1000) / 1000;
    }
    return bias;
  } catch {
    return {};
  }
}
