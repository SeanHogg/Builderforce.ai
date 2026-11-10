/**
 * Read a synced `run-outcome` record (`RunOutcomeRecordValue`, PRD 41 §D1) into the rows the
 * server stores — DEFENSIVELY. The payload is client-reported: every string is bounded to its
 * column, every number is finite (or null = not measured), every list is capped, and anything
 * that does not fit is REJECTED rather than truncated into a different fact.
 *
 * The device also keeps device-only `run-outcome` rows (the gate ledger: bare run id, no
 * `kind`). They are never journaled, so they should never arrive; a payload that is not a
 * `RunOutcomeRecordValue` is refused all the same.
 *
 * Pure: `now` is passed in. Client times later than `now` are clamped to it — except a label's
 * `windowEndsAt`, which is legitimately in the future — so a skewed clock cannot pin a
 * `computedAt` the server's own labeller could never supersede.
 */

import {
  FEATURE_IDS_BY_SCHEMA, featureDigest, isRunOutcomeRecordValue, LABELLER_VERSION, RUN_FEATURES_SCHEMA_VERSION,
  type RunLabelKind,
} from '@builderforce/run-delta/predict';
import { isReservedClientRunId } from '../execution/cloudRunId';

export const RUN_ID_MAX = 128;
export const REPOSITORY_MAX = 512;
export const PATH_MAX = 1024;
export const BRANCH_MAX = 255;
export const MAX_ATTRIBUTIONS = 2000;
export const MAX_FEATURE_VALUES = 512;
const FEATURE_ID_MAX = 128;
const MODEL_TIER_MAX = 64;
const PERSON_ID_MAX = 128;
const MAX_EVIDENCE = 32;
const EVIDENCE_KEY_MAX = 64;
const EVIDENCE_VALUE_MAX = 256;
const MAX_ADDED_LINES = 10_000_000;
const MAX_VERSION = 1000;

const LABEL_KINDS: ReadonlySet<string> = new Set(Object.keys(LABELLER_VERSION));

/** A record from a client whose feature schema is NEWER than this server's: retry after the deploy, never drop. */
export const RUN_FEATURES_SCHEMA_AHEAD = 'run_features_schema_version_ahead';
/** Refusals the importer answers as `pending` (the sync's existing retry-later outcome), not as a permanent rejection. */
export const RETRYABLE_RUN_OUTCOME_REFUSALS: ReadonlySet<string> = new Set([RUN_FEATURES_SCHEMA_AHEAD]);
const ENTRY_POINTS = new Set(['vscode', 'cloud', 'web']);
const MODES = new Set(['interactive', 'autonomous']);
const SOURCES = new Set(['vscode-git', 'cloud-finalize']);
const LABEL_STATUSES = new Set(['final', 'censored']);

export interface ParsedRunFeatures {
  entryPoint: string;
  mode: string;
  modelTier: string | null;
  schemaVersion: number;
  finalizedAt: Date;
  values: Record<string, number | null>;
  digest: string;
  requesterId: string | null;
  approverId: string | null;
  reviewerId: string | null;
  agentId: string | null;
}

export interface ParsedAttribution {
  commitSha: string;
  path: string;
  branch: string | null;
  addedLines: number | null;
  committedAt: Date;
  source: 'vscode-git' | 'cloud-finalize';
}

export interface ParsedLabel {
  kind: RunLabelKind;
  value: boolean | null;
  status: 'final' | 'censored';
  eventAt: Date | null;
  windowEndsAt: Date | null;
  evidence: Record<string, string | number>;
  labellerVersion: number;
  computedAt: Date;
}

export interface ParsedRunOutcome {
  runId: string;
  repository: string;
  features: ParsedRunFeatures;
  attributions: ParsedAttribution[];
  labels: ParsedLabel[];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; detail: string };

class Refused extends Error {
  constructor(readonly detail: string) { super(detail); }
}
const refuse = (detail: string): never => { throw new Refused(detail); };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function boundedString(v: unknown, max: number, detail: string): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > max || v.includes('\0')) return refuse(detail);
  return v;
}

function optionalString(v: unknown, max: number, detail: string): string | null {
  if (v === undefined || v === null) return null;
  return boundedString(v, max, detail);
}

function time(v: unknown, detail: string, now: Date, clamp = true): Date {
  const at = typeof v === 'string' ? new Date(v) : null;
  if (!at || Number.isNaN(at.getTime())) return refuse(detail);
  return clamp && at.getTime() > now.getTime() ? now : at;
}

function optionalTime(v: unknown, detail: string, now: Date, clamp = true): Date | null {
  return v === undefined || v === null ? null : time(v, detail, now, clamp);
}

/** `v` when it is one of `allowed`, else refused. */
function oneOf(v: unknown, allowed: ReadonlySet<string>, detail: string): string {
  return typeof v === 'string' && allowed.has(v) ? v : refuse(detail);
}

function smallInt(v: unknown, min: number, max: number, detail: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return refuse(detail);
  return v;
}

/** A repository identity: a remote URL or `local:<hash>`, never a local filesystem path. */
function repositoryOf(v: unknown): string {
  const repository = boundedString(v, REPOSITORY_MAX, 'run_outcome_repository_invalid');
  if (repository.startsWith('/') || /^[A-Za-z]:[\\/]/.test(repository) || repository.startsWith('\\')) {
    return refuse('run_outcome_repository_is_path');
  }
  return repository;
}

function featureValues(v: unknown): Record<string, number | null> {
  if (!isObject(v)) return refuse('run_features_values_invalid');
  const entries = Object.entries(v);
  if (entries.length === 0 || entries.length > MAX_FEATURE_VALUES) return refuse('run_features_values_invalid');
  const out: Record<string, number | null> = {};
  for (const [id, value] of entries) {
    if (id.length > FEATURE_ID_MAX || !/^[A-Za-z0-9_.-]+$/.test(id)) return refuse('run_features_value_id_invalid');
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) return refuse('run_features_value_not_finite');
    out[id] = value as number | null;
  }
  return out;
}

function featuresOf(v: unknown, runId: string, repository: string, now: Date): ParsedRunFeatures {
  if (!isObject(v)) return refuse('run_features_invalid');
  if (v.runId !== runId || v.repository !== repository) return refuse('run_features_identity_mismatch');
  const rawRun = v.run;
  const rawPeople = v.people;
  const run: Record<string, unknown> = isObject(rawRun) ? rawRun : refuse('run_features_run_invalid');
  const people: Record<string, unknown> = rawPeople === undefined ? {} : isObject(rawPeople) ? rawPeople : refuse('run_features_people_invalid');
  const entryPoint = oneOf(run.entryPoint, ENTRY_POINTS, 'run_features_entry_point_invalid');
  const mode = oneOf(run.mode, MODES, 'run_features_mode_invalid');
  const rawDigest = v.digest;
  const digest = typeof rawDigest === 'string' && /^[0-9a-f]{64}$/.test(rawDigest) ? rawDigest : refuse('run_features_digest_invalid');
  const schemaVersion = smallInt(v.schemaVersion, 1, MAX_VERSION, 'run_features_schema_version_invalid');
  const values = featureValues(v.values);
  // The vector feeds the cross-tenant model: only the ids of ITS OWN schema version (every version
  // still listed in FEATURE_IDS_BY_SCHEMA is accepted — the server deploys before clients update,
  // so older clients are the common case), and the digest the server recomputes over that
  // version's ids — a smuggled key or a vector its digest does not name never lands. A version
  // NEWER than this server is a client ahead of the deploy: refused as retryable
  // (RETRYABLE_RUN_OUTCOME_REFUSALS), so the device keeps it pending, never drops it.
  if (schemaVersion > RUN_FEATURES_SCHEMA_VERSION) return refuse(RUN_FEATURES_SCHEMA_AHEAD);
  const ids = FEATURE_IDS_BY_SCHEMA[schemaVersion];
  if (!ids) return refuse('run_features_schema_version_unsupported');
  const known = new Set(ids);
  if (Object.keys(values).some((id) => !known.has(id))) return refuse('run_features_value_id_unknown');
  if (featureDigest(values, ids) !== digest) return refuse('run_features_digest_mismatch');
  return {
    entryPoint,
    mode,
    modelTier: optionalString(run.modelTier, MODEL_TIER_MAX, 'run_features_model_tier_invalid'),
    schemaVersion,
    finalizedAt: time(v.finalizedAt, 'run_features_finalized_at_invalid', now),
    values,
    digest,
    requesterId: optionalString(people.requesterId, PERSON_ID_MAX, 'run_features_person_invalid'),
    approverId: optionalString(people.approverId, PERSON_ID_MAX, 'run_features_person_invalid'),
    reviewerId: optionalString(people.reviewerId, PERSON_ID_MAX, 'run_features_person_invalid'),
    agentId: optionalString(people.agentId, PERSON_ID_MAX, 'run_features_person_invalid'),
  };
}

/** Whether the features declare a valid schema version NEWER than this server's. */
function schemaVersionAhead(v: unknown): boolean {
  if (!isObject(v)) return false;
  const version = v.schemaVersion;
  return typeof version === 'number' && Number.isInteger(version) && version > RUN_FEATURES_SCHEMA_VERSION && version <= MAX_VERSION;
}

function attributionOf(v: unknown, now: Date): ParsedAttribution {
  if (!isObject(v)) return refuse('run_attribution_invalid');
  const rawSha = v.commitSha;
  const commitSha = typeof rawSha === 'string' && /^[0-9a-f]{7,64}$/i.test(rawSha) ? rawSha.toLowerCase() : refuse('run_attribution_sha_invalid');
  const path = boundedString(v.path, PATH_MAX, 'run_attribution_path_invalid');
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return refuse('run_attribution_path_not_relative');
  const source = oneOf(v.source, SOURCES, 'run_attribution_source_invalid') as ParsedAttribution['source'];
  return {
    commitSha,
    path,
    branch: optionalString(v.branch, BRANCH_MAX, 'run_attribution_branch_invalid'),
    addedLines: v.addedLines === undefined || v.addedLines === null ? null : smallInt(v.addedLines, 0, MAX_ADDED_LINES, 'run_attribution_added_lines_invalid'),
    committedAt: time(v.committedAt, 'run_attribution_committed_at_invalid', now),
    source,
  };
}

function evidenceOf(v: unknown): Record<string, string | number> {
  if (v === undefined) return {};
  if (!isObject(v)) return refuse('run_label_evidence_invalid');
  const entries = Object.entries(v);
  if (entries.length > MAX_EVIDENCE) return refuse('run_label_evidence_invalid');
  const out: Record<string, string | number> = {};
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > EVIDENCE_KEY_MAX) return refuse('run_label_evidence_invalid');
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string' && value.length <= EVIDENCE_VALUE_MAX) out[key] = value;
    else return refuse('run_label_evidence_invalid');
  }
  return out;
}

function labelOf(v: unknown, now: Date): ParsedLabel {
  if (!isObject(v)) return refuse('run_label_invalid');
  const kind = oneOf(v.kind, LABEL_KINDS, 'run_label_kind_invalid') as RunLabelKind;
  const status = oneOf(v.status, LABEL_STATUSES, 'run_label_status_invalid') as ParsedLabel['status'];
  const rawValue = v.value;
  const value: boolean | null = rawValue === null || typeof rawValue === 'boolean' ? rawValue : refuse('run_label_value_invalid');
  // Censored means "not yet known": the event already seen (true) or nothing yet (null), never false.
  if (status === 'censored' && value === false) return refuse('run_label_censored_false');
  return {
    kind,
    value,
    status,
    eventAt: optionalTime(v.eventAt, 'run_label_event_at_invalid', now),
    windowEndsAt: optionalTime(v.windowEndsAt, 'run_label_window_invalid', now, false),
    evidence: evidenceOf(v.evidence),
    labellerVersion: smallInt(v.labellerVersion, 1, MAX_VERSION, 'run_label_version_invalid'),
    computedAt: time(v.computedAt, 'run_label_computed_at_invalid', now),
  };
}

/**
 * Parse one synced run-outcome. The rows are keyed by the PAYLOAD's (runId, repository), never
 * by the event's entity id: the sync envelope requires a UUID-shaped `clientEntityId`
 * (`isJournalEventId`), so the device's `run-outcome:<runId>:<repoKey>` record key cannot be
 * it verbatim and the server does not try to read one out of it.
 */
export function parseRunOutcomeRecord(payload: unknown, now: Date): ParseResult<ParsedRunOutcome> {
  if (!isRunOutcomeRecordValue(payload)) return { ok: false, detail: 'run_outcome_not_a_record' };
  try {
    const raw = payload as unknown as Record<string, unknown>;
    const runId = boundedString(raw.runId, RUN_ID_MAX, 'run_outcome_run_id_invalid');
    // The cloud's run ids are minted by the server; a device may not report one.
    if (isReservedClientRunId(runId)) return { ok: false, detail: 'run_outcome_run_id_reserved' };
    const repository = repositoryOf(raw.repository);
    // A client AHEAD of this server is read for its schema version BEFORE anything else: its
    // labels and attributions may use a kind or field this server does not know yet, which must
    // be the retryable `ahead` (pending), never a permanent `run_label_kind_invalid`.
    if (schemaVersionAhead(raw.features)) return { ok: false, detail: RUN_FEATURES_SCHEMA_AHEAD };
    const rawAttribution = raw.attribution;
    const rawLabels = raw.labels;
    const attribution: unknown[] = Array.isArray(rawAttribution) ? rawAttribution : refuse('run_attribution_invalid');
    if (attribution.length > MAX_ATTRIBUTIONS) return { ok: false, detail: 'run_attribution_too_many' };
    const labelsRaw: unknown[] = Array.isArray(rawLabels) ? rawLabels : refuse('run_label_invalid');
    if (labelsRaw.length > LABEL_KINDS.size) return { ok: false, detail: 'run_label_too_many' };
    const labels = labelsRaw.map((label) => labelOf(label, now));
    if (new Set(labels.map((l) => l.kind)).size !== labels.length) return { ok: false, detail: 'run_label_kind_duplicate' };
    return {
      ok: true,
      value: {
        runId,
        repository,
        features: featuresOf(raw.features, runId, repository, now),
        attributions: attribution.map((a) => attributionOf(a, now)),
        labels,
      },
    };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, detail: error.detail };
    throw error;
  }
}
