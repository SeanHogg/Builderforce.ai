/**
 * The synced `run-delta` local record (PRD 41 §C14) as the server reads it — validated and reduced to the
 * rows `run_deltas` / `run_delta_dimensions` / `run_delta_findings` hold. Pure: no I/O, no clock.
 *
 * The client writes the record under `stableEntityId('run-delta:<runId>:<repoKey>')` (every synced client id is a
 * UUID) with the value `{ runId, repoKey, repository, changeSetId, chatId, mode, delta, computedMs, projectId?,
 * surface?, computedAt?, overridesDropped? }` (`clients/vscode/src/runDelta/runDeltaRecords.ts`). Run, repository key
 * and project are read from the PAYLOAD, never parsed out of the id; the id must be the one those name, so one
 * record cannot be replayed under another run's key.
 *
 * A payload that cannot be stored faithfully is REJECTED (never truncated into a different delta), so a bad client
 * is answered once instead of retried forever; one from a NEWER client (an unknown `RunDelta.version`) is held
 * `retry` (pending) until the server learns it. The digest is RECOMPUTED: it keys the evidence blob, so a
 * client-supplied digest could otherwise overwrite another delta's evidence.
 */

import { stableEntityId } from '@builderforce/local-first';
import {
  digestOf,
  summarizeRunDelta,
  type DeltaFinding,
  type Lineage,
  type RunDelta,
  type RunDeltaSummary,
  type RunDeltaSurface,
  type Verdict,
} from '@builderforce/run-delta';
import { redactText } from '@builderforce/secret-redaction';
import { sha256Hex } from '@seanhogg/builderforce-memory/knowledge';
import { CAPS, checkDelta, hasNul, isInt4, isRec, isText } from './runDeltaShape';

/** The natural key a run delta's client id is derived from. */
export const runDeltaKey = (runId: string, repoKey: string): string => `run-delta:${runId}:${repoKey}`;
/** The client entity id a delta of (run, repo key) must be synced under. */
export const runDeltaClientId = (runId: string, repoKey: string): string => stableEntityId(runDeltaKey(runId, repoKey));

/** At most this many findings are stored per delta. */
const MAX_FINDINGS = 5000;
/** The card text embedded per finding is bounded: a vector of a page of evidence is no better than of its summary. */
export const CARD_TEXT_MAX = 2000;
const SURFACES: ReadonlySet<string> = new Set<RunDeltaSurface>(['vscode', 'cloud', 'web']);

export interface RunDeltaDimensionRow {
  dimensionId: string;
  verdict: Verdict;
  introduced: number;
  resolved: number;
  changed: number;
}

export interface RunDeltaFindingRow {
  identityId: string;
  /** sha256 hex of `identityId`: the unique key within a delta (an identity id is unbounded). */
  identityHash: string;
  anchor: string;
  dimensionId: string;
  ruleId: string;
  ruleVersion: number;
  severity: string;
  lineage: Lineage;
  confidence: string;
  cardText: string;
}

/** A validated delta, ready to write. */
export interface ImportedRunDelta {
  summary: RunDeltaSummary;
  repository: string;
  /** The client's project reference (a mapped client UUID or a decimal server id), when it sent one. */
  projectRef: string | null;
  delta: RunDelta;
  deltaVersion: number;
  dimensions: RunDeltaDimensionRow[];
  findings: RunDeltaFindingRow[];
}

/** `retry`: hold the event (pending), it may be storable later (a newer client's format). */
export type Parsed<T> = { ok: true; value: T } | { ok: false; detail: string; retry?: true };

/**
 * The canonical card text a finding is embedded as: rule + params, anchor, the first snippet (whitespace-normalized)
 * and an evidence summary. Re-redacted (a secret must never reach the embedding vendor even if a client skipped its
 * own redaction), U+0000-free and bounded.
 */
export function findingCardText(f: DeltaFinding): string {
  const snippet = f.evidence.find((e) => typeof e.snippet === 'string' && e.snippet.trim())?.snippet ?? '';
  const normalized = snippet.split(/\r?\n/).map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n');
  const evidence = f.evidence.map((e) => `${e.side} ${e.path}${e.line ? `:${e.line}` : ''}${e.note ? ` ${e.note}` : ''}`).join('; ');
  const params = Object.keys(f.params).sort().map((k) => `${k}=${f.params[k]}`).join(', ');
  const text = [`${f.ruleId}${params ? ` (${params})` : ''}`, f.identity.anchor, normalized, evidence].filter(Boolean).join('\n');
  return redactText(text.replace(/\u0000/g, '')).slice(0, CARD_TEXT_MAX);
}

function rowsOf(delta: RunDelta): { dimensions: RunDeltaDimensionRow[]; findings: RunDeltaFindingRow[] } {
  const dimensions: RunDeltaDimensionRow[] = [];
  const findings = new Map<string, RunDeltaFindingRow>();
  for (const d of delta.dimensions) {
    const count = (l: Lineage) => d.findings.filter((f) => f.lineage === l).length;
    dimensions.push({ dimensionId: d.id, verdict: d.verdict, introduced: count('introduced'), resolved: count('resolved'), changed: count('changed') });
    for (const f of d.findings) {
      // One row per exact identity within a delta (the unique key); the first occurrence wins.
      if (findings.has(f.identity.id)) continue;
      findings.set(f.identity.id, {
        identityId: f.identity.id, identityHash: sha256Hex(f.identity.id), anchor: f.identity.anchor, dimensionId: d.id, ruleId: f.ruleId, ruleVersion: f.ruleVersion,
        severity: f.severity, lineage: f.lineage, confidence: f.confidence, cardText: findingCardText(f),
      });
    }
  }
  return { dimensions, findings: [...findings.values()] };
}

function projectRefOf(raw: unknown): string | null {
  if (typeof raw === 'number' && isInt4(raw) && raw > 0) return String(raw);
  if (typeof raw === 'string' && raw.trim() && raw.length <= 64 && !hasNul(raw)) return raw.trim();
  return null;
}

/**
 * Validate one synced `run-delta` value. `clamp` is the importer's client-time clamp (a future or unparseable time
 * becomes the server's now), applied to `computedAt` and to the event time it falls back to.
 */
export function readRunDeltaRecord(
  payload: unknown,
  clientEntityId: string,
  occurredAt: unknown,
  clamp: (raw: unknown) => Date,
): Parsed<ImportedRunDelta> {
  if (!isRec(payload)) return { ok: false, detail: 'payload_invalid' };
  const { runId, repoKey } = payload;
  if (!isText(runId, CAPS.runId) || !isText(repoKey, CAPS.repoKey)) return { ok: false, detail: 'run_delta_key_invalid' };
  if (clientEntityId.toLowerCase() !== runDeltaClientId(runId, repoKey)) return { ok: false, detail: 'run_delta_id_mismatch' };
  if (!isText(payload.repository, CAPS.repository)) return { ok: false, detail: 'run_delta_repository_invalid' };
  if (payload.mode !== 'interactive' && payload.mode !== 'autonomous') return { ok: false, detail: 'run_delta_mode_invalid' };
  const mode = payload.mode;

  const shape = checkDelta(payload.delta);
  if (!shape.ok) return shape;
  const delta = shape.delta;
  if (delta.runId !== runId) return { ok: false, detail: 'run_delta_run_mismatch' };
  if (digestOf(delta) !== delta.digest) return { ok: false, detail: 'run_delta_digest_mismatch' };

  const { dimensions, findings } = rowsOf(delta);
  if (findings.length > MAX_FINDINGS) return { ok: false, detail: 'run_delta_too_many_findings' };
  const surface = typeof payload.surface === 'string' && SURFACES.has(payload.surface) ? (payload.surface as RunDeltaSurface) : 'vscode';
  const computedAt = clamp(payload.computedAt !== undefined ? payload.computedAt : occurredAt).toISOString();
  return {
    ok: true,
    value: {
      summary: summarizeRunDelta(delta, { repoKey, surface, mode, computedAt }),
      repository: payload.repository,
      projectRef: projectRefOf(payload.projectId),
      delta,
      deltaVersion: delta.version,
      dimensions,
      findings,
    },
  };
}
