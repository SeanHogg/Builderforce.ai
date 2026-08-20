/**
 * project-evermind-delta — the ON-PREM producer for the PRE-DIFFED weight-delta door
 * (`POST /api/agent/projects/:id/evermind/learn`).
 *
 * The unified text path ({@link contributeProjectEvermindFromText}) hands the gateway
 * raw run text and lets the coordinator Durable Object do the fit inside its merge
 * alarm. That is the right trade for the CLOUD surfaces — a Worker's CPU budget is
 * small and shared. It is the wrong trade for an on-prem host, which is a long-lived
 * Node process with CPU to spare: every text contribution it posts adds one training
 * fit to the single writer that every OTHER contributor to that project is queued
 * behind, and ships the whole run text to the gateway to do it.
 *
 * This module is the other side of that trade. The host pulls the project's CURRENT
 * `.evermind` base, adapts a private copy of it on the run's text locally, diffs the
 * two checkpoints (`diffCheckpoints` — sparse, so a WSLA-scale update is kilobytes,
 * not the whole model), and pushes only the delta. The coordinator then merely
 * FedAvg-merges it: no fit, no run text, no queue behind someone else's training.
 *
 * The base version is load-bearing. A delta is only meaningful against the exact
 * checkpoint it was taken from, so the base artifact is fetched PINNED to the head
 * version and that same number is sent as `baseVersion`. If a merge lands in between,
 * the coordinator rejects the push with 409 + the new head rather than corrupting the
 * merge; {@link contributeProjectEvermindFromDelta} then rebases against that head and
 * retries ONCE, and falls back to the text path if it loses the race again — a
 * contribution is never dropped just because the project is busy.
 *
 * Best-effort throughout, and a no-op (never a crash) when the optional engine package
 * is absent, the project is unseeded/frozen, or the head is not an `evermind-lm`.
 */
import { contributeProjectEvermindFromText, type ContributeResult, type ProjectEvermindSyncConfig } from "./project-evermind-sync.js";

/** Chars of run text actually fed to one adaptation pass. Mirrors the coordinator's
 *  own `ADAPT_MAX_CHARS`, so a locally-produced delta is the same size of update the
 *  server-side text path would have produced from the same run. */
const ADAPT_MAX_CHARS = 4000;
/** Token window length for the adaptation training sequences (mirrors the coordinator). */
const ADAPT_WINDOW_TOKENS = 64;
/** The gateway's own cap on the base64 delta field (`MAX_DIFF_BYTES`, ~8 MiB). Checked
 *  BEFORE the POST so an oversized push falls back to the text path instead of eating a
 *  413 and losing the contribution. */
const MAX_DIFF_B64_CHARS = 8 * 1024 * 1024;
/** Minimum run text worth adapting on — matches the gateway's own floor. */
const MIN_TEXT_CHARS = 20;

// ── Engine seam ───────────────────────────────────────────────────────────────
// `@seanhogg/builderforce-memory-engine` is an OPTIONAL dependency of this package, so
// it is loaded through an indirect import (the same guard `ssm-memory-service` uses):
// a host that never installed it degrades to the text path rather than failing to boot.
// The structural types below are the whole surface this module uses.

/** A loaded Evermind language model — only its weight export is needed here. */
export interface DeltaEngineLM {
  exportWeights(): ArrayBuffer;
}

/** A parsed `.evermind` package: its raw checkpoint plus a loader for a private copy. */
export interface DeltaEnginePackage {
  checkpoint: ArrayBuffer;
  manifest: { modelType?: string };
  loadLM(): DeltaEngineLM;
}

/** The BPE tokenizer, restored from the version's published vocab + merges. */
export interface DeltaEngineTokenizer {
  loadFromObjects(vocab: Record<string, number>, merges: string[]): void;
  encode(text: string): number[];
}

/** The subset of the engine this producer needs. Injectable so the diff→payload→route
 *  contract is testable over synthetic checkpoints without a GPU or a real model. */
export interface DeltaEngine {
  EvermindModelPackage: { fromBlob(blob: ArrayBuffer): DeltaEnginePackage };
  EvermindLMTrainer: new (lm: DeltaEngineLM, opts: { epochs: number }) => { fit(seqs: number[][]): number[] };
  BPETokenizer: new () => DeltaEngineTokenizer;
  diffCheckpoints(base: ArrayBuffer, current: ArrayBuffer): ArrayBuffer;
}

/** Load the optional engine package, or null when it is not installed. */
export async function loadDeltaEngine(): Promise<DeltaEngine | null> {
  try {
    // Indirect import so TypeScript/bundlers never hard-resolve an optional peer.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const mod = (await (new Function("m", "return import(m)")("@seanhogg/builderforce-memory-engine") as Promise<unknown>)) as Partial<DeltaEngine>;
    if (!mod?.EvermindModelPackage || !mod.EvermindLMTrainer || !mod.BPETokenizer || typeof mod.diffCheckpoints !== "function") return null;
    return mod as DeltaEngine;
  } catch {
    return null;
  }
}

// ── Pure producer ─────────────────────────────────────────────────────────────

/** A published Evermind version: its packaged bytes and the tokenizer they were
 *  trained with, both pinned to the SAME version number. */
export interface EvermindBase {
  version: number;
  model: ArrayBuffer;
  tokenizer: { vocab: Record<string, number>; merges: string[] };
}

/** Chunk token ids into fixed-length training windows (min length 2). Mirrors the
 *  coordinator's `windows` so a local fit and a server-side fit see the same batches. */
function windows(ids: number[], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 1 < ids.length; i += size) {
    const seq = ids.slice(i, i + size);
    if (seq.length >= 2) out.push(seq);
  }
  return out;
}

/** Base64 a binary buffer (Node) — the wire encoding the `learn` door expects. */
export function encodeDeltaB64(diff: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(diff)).toString("base64");
}

/**
 * Adapt a private copy of `base` on `text` and return the SPARSE checkpoint diff, or
 * null when there is nothing to contribute (not an `evermind-lm`, or the text yields no
 * trainable window). Pure with respect to the network, and pure with respect to `base`:
 * the fit runs on a freshly-loaded LM, so the caller's buffer is never mutated and the
 * diff is genuinely "this run's update" rather than an accumulation.
 */
export function adaptAndDiff(engine: DeltaEngine, base: EvermindBase, text: string): ArrayBuffer | null {
  const pkg = engine.EvermindModelPackage.fromBlob(base.model);
  if (pkg.manifest.modelType !== "evermind-lm") return null;
  const tok = new engine.BPETokenizer();
  tok.loadFromObjects(base.tokenizer.vocab, base.tokenizer.merges);
  const seqs = windows(tok.encode(text.slice(0, ADAPT_MAX_CHARS)), ADAPT_WINDOW_TOKENS);
  if (seqs.length === 0) return null;
  const lm = pkg.loadLM();
  new engine.EvermindLMTrainer(lm, { epochs: 1 }).fit(seqs);
  return engine.diffCheckpoints(pkg.checkpoint, lm.exportWeights());
}

/** The exact JSON body the `learn` door parses (`diff` base64, `baseVersion` integer). */
export interface DeltaLearnPayload {
  diff: string;
  baseVersion: number;
  weight: number;
  label?: string;
}

/**
 * Build the wire payload for one adapted base. Returns null when nothing was learnable;
 * the size guard is the caller's, so it can choose the text fallback knowingly.
 */
export function buildDeltaPayload(
  engine: DeltaEngine,
  base: EvermindBase,
  text: string,
  weight: number,
  label?: string,
): DeltaLearnPayload | null {
  const diff = adaptAndDiff(engine, base, text);
  if (!diff) return null;
  const trimmedLabel = (label ?? "").trim();
  return {
    diff: encodeDeltaB64(diff),
    baseVersion: base.version,
    weight,
    ...(trimmedLabel ? { label: trimmedLabel.slice(0, 800) } : {}),
  };
}

// ── Gateway transport ─────────────────────────────────────────────────────────

function authHeaders(cfg: ProjectEvermindSyncConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.apiKey}`, "X-AgentHost-Id": String(cfg.agentHostId) };
}

function agentBase(cfg: ProjectEvermindSyncConfig): string {
  return `${cfg.gatewayUrl}/api/agent/projects/${cfg.projectId}/evermind`;
}

/** The project's current head version, or null when unreadable / unseeded / frozen. */
async function fetchHeadVersion(cfg: ProjectEvermindSyncConfig): Promise<{ version: number; frozen: boolean } | null> {
  try {
    const res = await fetch(`${agentBase(cfg)}/head`, { headers: authHeaders(cfg) });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const version = typeof body["version"] === "number" ? body["version"] : 0;
    if (version <= 0) return null;
    return { version, frozen: body["mode"] === "offline-frozen" };
  } catch {
    return null;
  }
}

/**
 * Pull one PINNED version's model + tokenizer. Pinning is not an optimisation: an
 * unpinned fetch could hand back a newer artifact than the version we are about to
 * claim as `baseVersion`, which is precisely the corruption the stale-base guard exists
 * to prevent — and it would sail past that guard, because the number would look current.
 */
async function fetchBase(cfg: ProjectEvermindSyncConfig, version: number): Promise<EvermindBase | null> {
  try {
    const q = `?version=${version}`;
    const [modelRes, tokRes] = await Promise.all([
      fetch(`${agentBase(cfg)}/model${q}`, { headers: authHeaders(cfg) }),
      fetch(`${agentBase(cfg)}/tokenizer${q}`, { headers: authHeaders(cfg) }),
    ]);
    if (!modelRes.ok || !tokRes.ok) return null;
    const model = await modelRes.arrayBuffer();
    const tokenizer = (await tokRes.json()) as { vocab?: Record<string, number>; merges?: string[] };
    if (!tokenizer?.vocab || !Array.isArray(tokenizer.merges)) return null;
    return { version, model, tokenizer: { vocab: tokenizer.vocab, merges: tokenizer.merges } };
  } catch {
    return null;
  }
}

/** Outcome of ONE delta POST, distinguishing a STALE base (recoverable by rebasing)
 *  from every other refusal (not recoverable by retrying the same way). */
interface PushOutcome {
  ok: boolean;
  /** The head the coordinator reported when it rejected a stale base. */
  staleHeadVersion?: number;
  reason?: string;
  version?: number;
}

async function pushDelta(cfg: ProjectEvermindSyncConfig, payload: DeltaLearnPayload): Promise<PushOutcome> {
  try {
    const res = await fetch(`${agentBase(cfg)}/learn`, {
      method: "POST",
      headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, version: payload.baseVersion };
    // 409 + a headVersion is the ONE refusal a producer can act on: the base moved, so
    // recompute against the head it named. Anything else (unseeded, frozen, too large,
    // unauthorized) is not fixed by trying again with a different number.
    if (res.status === 409 && typeof body["headVersion"] === "number") {
      return { ok: false, staleHeadVersion: body["headVersion"] as number, reason: "stale base" };
    }
    return { ok: false, reason: typeof body["error"] === "string" ? (body["error"] as string) : `learn ${res.status}` };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

/** Extra detail a delta contribution reports beyond the shared {@link ContributeResult}. */
export interface DeltaContributeResult extends ContributeResult {
  /** True when the contribution went out as a pre-diffed weight delta. */
  delta?: boolean;
  /** True when the delta path gave up and the text door carried the contribution. */
  fellBackToText?: boolean;
  /** True when a stale-base rejection forced a rebase against a newer head. */
  rebased?: boolean;
}

/**
 * Contribute a run to the project's Evermind as a PRE-DIFFED WEIGHT DELTA, falling back
 * to the text door whenever the delta path cannot honestly complete.
 *
 * Fallback is deliberate and total: the delta path is a CPU optimisation, never a
 * gate on whether the project learns. Every exit that is not a successful push —
 * engine absent, unseeded/frozen head, unfetchable artifact, non-LM base, no trainable
 * window, oversized diff, a lost rebase race — ends in {@link contributeProjectEvermindFromText}
 * so the contribution still lands. Never throws.
 */
export async function contributeProjectEvermindFromDelta(
  cfg: ProjectEvermindSyncConfig,
  text: string,
  prompt?: string,
  weight?: number,
  deps?: { loadEngine?: () => Promise<DeltaEngine | null> },
): Promise<DeltaContributeResult> {
  const trimmed = (text ?? "").trim();
  if (trimmed.length < MIN_TEXT_CHARS) return { ok: false, reason: "text too short" };
  const learnWeight = Math.max(0.05, Math.min(1, typeof weight === "number" && weight > 0 ? weight : 0.6));
  const toText = async (reason: string): Promise<DeltaContributeResult> => ({
    ...(await contributeProjectEvermindFromText(cfg, trimmed, prompt, learnWeight)),
    delta: false,
    fellBackToText: true,
    reason,
  });

  const engine = await (deps?.loadEngine ?? loadDeltaEngine)();
  if (!engine) return toText("engine unavailable");

  const head = await fetchHeadVersion(cfg);
  // An unseeded project has no base to diff against, and a frozen one rejects every
  // write — the text door reports both far more usefully than a fabricated delta would.
  if (!head || head.frozen) return toText(head ? "offline-frozen" : "no seeded head");

  // The run's TASK is the delta's only provenance: a weight diff carries no text, so
  // without a label its inspection row is an anonymous number.
  const label = (prompt ?? "").trim() || undefined;

  for (let attempt = 0, baseVersion = head.version; attempt < 2; attempt++) {
    const base = await fetchBase(cfg, baseVersion);
    if (!base) return toText("base artifact unavailable");

    let payload: DeltaLearnPayload | null;
    try {
      payload = buildDeltaPayload(engine, base, trimmed, learnWeight, label);
    } catch (err) {
      return toText(`adapt failed: ${String(err)}`);
    }
    if (!payload) return toText("nothing trainable in this run");
    if (payload.diff.length > MAX_DIFF_B64_CHARS) return toText("delta exceeds the gateway's size cap");

    const outcome = await pushDelta(cfg, payload);
    if (outcome.ok) {
      return { ok: true, delta: true, version: outcome.version ?? baseVersion, ...(attempt > 0 ? { rebased: true } : {}) };
    }
    // A merge landed between our pull and our push. Rebase onto the head the
    // coordinator named and recompute — once. A second loss means the project is
    // merging faster than this host can diff, and the text door is the honest answer:
    // the coordinator adapts against whatever the head is at alarm time, so it cannot
    // go stale at all.
    if (outcome.staleHeadVersion && outcome.staleHeadVersion !== baseVersion) {
      baseVersion = outcome.staleHeadVersion;
      continue;
    }
    return toText(outcome.reason ?? "delta rejected");
  }
  return toText("lost the rebase race twice");
}
