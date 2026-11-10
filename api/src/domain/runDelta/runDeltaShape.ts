/**
 * The STORABILITY checks of a synced run delta (PRD 41 §C14). A payload passing these can be written to
 * `run_deltas` / `run_delta_dimensions` / `run_delta_findings` without a database error: every string fits its
 * column and index (byte caps, not character caps — a btree key is bounded in bytes), no string holds U+0000
 * (Postgres `text` and `jsonb` refuse it), every integer fits int4, dimension ids are unique (the primary key).
 * A value that fails is REJECTED by the importer, never truncated into a different delta. Pure.
 */

import type { DeltaFinding, DimensionResult, Evidence, RunDelta } from '@builderforce/run-delta';

type Rec = Record<string, unknown>;
export const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

const encoder = new TextEncoder();
/** UTF-8 length. */
export const byteLength = (s: string): number => encoder.encode(s).length;

/** Byte caps of the indexed / bounded columns (migration 1344). */
export const CAPS = {
  runId: 128,
  repoKey: 128,
  repository: 512,
  /** Stored as `text` (it lists every member path); the unique index is on its sha256 (`identity_hash`). */
  identityId: 65_536,
  /** Indexed directly (`run_delta_findings_tenant_anchor_idx`): a btree key is bounded in bytes. */
  anchor: 1024,
  ruleId: 128,
  dimensionId: 64,
  path: 4096,
  text: 16_384,
} as const;

const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;
export const isInt4 = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= INT4_MIN && (v as number) <= INT4_MAX;

export const hasNul = (s: string): boolean => s.includes('\u0000');

/** A non-empty string within `maxBytes`, with no U+0000. */
export const isText = (v: unknown, maxBytes: number): v is string =>
  typeof v === 'string' && v.length > 0 && !hasNul(v) && byteLength(v) <= maxBytes;

const VERDICTS: ReadonlySet<string> = new Set(['better', 'worse', 'same', 'not_comparable', 'not_measured']);
const LINEAGES: ReadonlySet<string> = new Set(['introduced', 'resolved', 'changed', 'persisting', 'present']);
const SEVERITIES: ReadonlySet<string> = new Set(['info', 'warn', 'error']);
const CONFIDENCES: ReadonlySet<string> = new Set(['measured', 'heuristic']);
const BANDS: ReadonlySet<string> = new Set(['low', 'medium', 'high']);
const DIGEST = /^[0-9a-f]{64}$/;

export const isVerdict = (v: unknown): boolean => typeof v === 'string' && VERDICTS.has(v);

const optionalText = (v: unknown, max: number): boolean => v === undefined || (typeof v === 'string' && !hasNul(v) && byteLength(v) <= max);

function validEvidence(e: unknown): e is Evidence {
  return isRec(e) && (e.side === 'before' || e.side === 'after') && isText(e.path, CAPS.path)
    && (e.line === undefined || isInt4(e.line))
    && optionalText(e.snippet, CAPS.text) && optionalText(e.note, CAPS.text);
}

function validParams(p: unknown): boolean {
  if (!isRec(p)) return false;
  return Object.entries(p).every(([k, v]) => !hasNul(k)
    && ((typeof v === 'string' && !hasNul(v)) || (typeof v === 'number' && Number.isFinite(v))));
}

export function validFinding(f: unknown): f is DeltaFinding {
  if (!isRec(f) || !isRec(f.identity)) return false;
  return isText(f.identity.id, CAPS.identityId) && isText(f.identity.anchor, CAPS.anchor)
    && isText(f.ruleId, CAPS.ruleId) && isInt4(f.ruleVersion)
    && typeof f.severity === 'string' && SEVERITIES.has(f.severity)
    && typeof f.lineage === 'string' && LINEAGES.has(f.lineage)
    && typeof f.confidence === 'string' && CONFIDENCES.has(f.confidence)
    && validParams(f.params)
    && Array.isArray(f.evidence) && f.evidence.every(validEvidence);
}

function validDimension(d: unknown): d is DimensionResult {
  return isRec(d) && isText(d.id, CAPS.dimensionId) && isVerdict(d.verdict)
    && Array.isArray(d.findings) && d.findings.every(validFinding) && Array.isArray(d.reasons) && Array.isArray(d.metrics);
}

/** `RunDelta.version` this server stores. A newer client's delta is held (pending) until the server learns it. */
export const SUPPORTED_DELTA_VERSION = 1;

export type DeltaShape = { ok: true; delta: RunDelta } | { ok: false; detail: string; retry?: true };

/** Structural validation of `RunDelta` (version gate first: an unknown version is never parsed as v1). */
export function checkDelta(d: unknown): DeltaShape {
  if (!isRec(d)) return { ok: false, detail: 'run_delta_invalid' };
  if (!Number.isSafeInteger(d.version) || (d.version as number) < 1) return { ok: false, detail: 'run_delta_version_invalid' };
  if ((d.version as number) > SUPPORTED_DELTA_VERSION) return { ok: false, detail: 'run_delta_version_unsupported', retry: true };
  if (!isText(d.runId, CAPS.runId) || typeof d.digest !== 'string' || !DIGEST.test(d.digest)) return { ok: false, detail: 'run_delta_invalid' };
  if (!isVerdict(d.headline) || !isRec(d.summary) || JSON.stringify(d.summary).includes('\\u0000')) return { ok: false, detail: 'run_delta_invalid' };
  const br = d.blastRadius;
  if (!isRec(br) || typeof br.score !== 'number' || !Number.isFinite(br.score) || typeof br.band !== 'string' || !BANDS.has(br.band)) {
    return { ok: false, detail: 'run_delta_invalid' };
  }
  if (!Array.isArray(d.blocking) || !d.blocking.every((c) => isText(c, CAPS.ruleId * 2))) return { ok: false, detail: 'run_delta_invalid' };
  if (!Array.isArray(d.dimensions) || !d.dimensions.every(validDimension)) return { ok: false, detail: 'run_delta_invalid' };
  const ids = d.dimensions.map((x) => (x as DimensionResult).id);
  if (new Set(ids).size !== ids.length) return { ok: false, detail: 'run_delta_dimension_duplicate' };
  return { ok: true, delta: d as unknown as RunDelta };
}
