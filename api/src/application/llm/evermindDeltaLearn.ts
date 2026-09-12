/**
 * evermindDeltaLearn — the CONTRACT of the pre-diffed weight-delta door
 * (`POST /api/{projects,agent/projects}/:id/evermind/learn`).
 *
 * The door exists for the on-prem runner (agent-runtime `project-evermind-delta.ts`):
 * a long-lived Node host with CPU to spare pulls the project's head PINNED to a
 * version, adapts a private copy on its run, `diffCheckpoints`-es the two and pushes
 * only the sparse diff — so the coordinator Durable Object merely FedAvg-merges it
 * instead of running the fit in its own alarm, queued behind every other project
 * contributor. Decided 2026-09-12 (operator): wire the on-prem runner to push diffs.
 *
 * Everything the gateway route and the coordinator must AGREE on lives here, once:
 *   - the wire shape (`diff` base64 + integer `baseVersion`, optional weight/label);
 *   - the size cap (mirrored by the producer's own pre-POST check, so an oversized
 *     push falls back to the text door instead of eating a 413);
 *   - the admission rule against the head — unseeded → 409, frozen → 423, and a
 *     STALE base → 409 carrying `headVersion`, the one refusal a producer can act on
 *     (re-pull that head, re-diff, re-push);
 *   - the per-delta structural check the merge runs before folding a diff in.
 *
 * That last one is load-bearing. `mergeCheckpointDiffs` throws on a malformed diff,
 * and one throw inside the merge drops EVERY entry the alarm had already consumed —
 * text fits included. A single bad push must cost only itself, so each delta is
 * validated on its own before it joins the batch.
 */
import { deserializeRowDelta, verifyCrcTrailer } from '@seanhogg/builderforce-memory-engine';

/** Max accepted base64 delta, in characters (~8 MiB). The producer checks the same
 *  number before POSTing (`MAX_DIFF_B64_CHARS` in agent-runtime). */
export const MAX_DELTA_B64_CHARS = 8 * 1024 * 1024;

/** Chars of provenance label kept — a diff carries no text, so the label (the run's
 *  ticket) is the only thing that makes the merged row inspectable. */
export const DELTA_LABEL_MAX_CHARS = 800;

/** Standard base64 alphabet with optional padding. Validated at the door so a corrupt
 *  body is a 400 at push time, never an `atob` throw inside the merge alarm. */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** A validated delta push. */
export interface DeltaLearnRequest {
  /** base64 serialized RowDelta (`diffCheckpoints(base, adapted)`). */
  diff: string;
  /** The head version the delta was diffed against. */
  baseVersion: number;
  /** FedAvg sample weight (> 0). Absent → the coordinator's default (1). */
  weight?: number;
  /** Provenance for the inspection row (the run's ticket). */
  label?: string;
}

export type DeltaParseResult =
  | { ok: true; request: DeltaLearnRequest }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Parse + validate a delta push body. Pure — the route calls it to refuse a bad or
 * oversized body before it ever reaches the coordinator, and the coordinator calls it
 * again because it is the single writer and trusts no caller.
 */
export function parseDeltaLearnRequest(raw: unknown): DeltaParseResult {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const diff = typeof body.diff === 'string' ? body.diff : '';
  const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : Number.NaN;
  if (!diff || !Number.isInteger(baseVersion)) {
    return { ok: false, status: 400, error: 'diff (base64) and baseVersion (integer head version the delta was taken against) are required' };
  }
  if (diff.length > MAX_DELTA_B64_CHARS) {
    return { ok: false, status: 413, error: `delta too large (max ${MAX_DELTA_B64_CHARS} base64 characters)` };
  }
  if (diff.length % 4 !== 0 || !BASE64_RE.test(diff)) {
    return { ok: false, status: 400, error: 'diff must be standard base64' };
  }
  const weight = typeof body.weight === 'number' && Number.isFinite(body.weight) && body.weight > 0 ? body.weight : undefined;
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, DELTA_LABEL_MAX_CHARS) : undefined;
  return {
    ok: true,
    request: { diff, baseVersion, ...(weight !== undefined ? { weight } : {}), ...(label ? { label } : {}) },
  };
}

/** Why a delta was not admitted, as the HTTP answer the producer branches on. */
export interface DeltaRefusal {
  status: 409 | 423;
  body: Record<string, unknown>;
}

/**
 * Admit a parsed delta against the CURRENT head, or say why not. Pure.
 *
 * Order matters: an unseeded project has no base to be stale against, and a frozen
 * one rejects every write whatever its base — neither is fixed by rebasing, so both
 * are answered before the stale check. The stale refusal names `headVersion` because
 * a producer cannot rebase without being told what to rebase ONTO.
 */
export function admitDeltaAgainstHead(
  request: Pick<DeltaLearnRequest, 'baseVersion'>,
  head: { version: number; mode: string },
): DeltaRefusal | null {
  if (head.version === 0) {
    return { status: 409, body: { ok: false, error: 'project Evermind not seeded — no base model to learn against' } };
  }
  if (head.mode === 'offline-frozen') {
    return { status: 423, body: { ok: false, error: 'project Evermind is offline-frozen (read-only); learning disabled', mode: head.mode } };
  }
  if (request.baseVersion !== head.version) {
    return { status: 409, body: { ok: false, error: 'stale base — rebase against current head', headVersion: head.version } };
  }
  return null;
}

/** Decode a base64 delta to bytes (Workers + Node both provide `atob`). */
export function decodeDeltaB64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * Structural check of ONE delta against the base it claims to diff: it must
 * deserialize, be element-granular (what `diffCheckpoints` emits and what the FedAvg
 * merge requires), index only elements the base actually has, and carry finite
 * values. Returns the reason it is unusable, or null when it can join the merge.
 *
 * The version guard already ensures the producer diffed the right head; this catches
 * a buffer that is simply not a diff of it (truncated upload, wrong model family, a
 * producer bug) — any of which would otherwise throw inside `mergeCheckpointDiffs`
 * and take the rest of the alarm's batch down with it.
 */
export function deltaUnusableReason(delta: ArrayBuffer, baseCheckpoint: ArrayBuffer): string | null {
  try {
    const rd = deserializeRowDelta(delta);
    if (rd.rowSize !== 1) return `expected an element-granular delta (rowSize 1), got ${rd.rowSize}`;
    const elements = verifyCrcTrailer(baseCheckpoint).body.byteLength / 4;
    for (let i = 0; i < rd.rows.length; i++) {
      const idx = rd.rows[i]!;
      if (!Number.isInteger(idx) || idx < 0 || idx >= elements) return `row index ${idx} is outside the base checkpoint (${elements} elements)`;
      if (!Number.isFinite(rd.data[i]!)) return `non-finite value at row ${idx}`;
    }
    return null;
  } catch (error) {
    return `not a serialized RowDelta: ${error instanceof Error ? error.message : String(error)}`;
  }
}
