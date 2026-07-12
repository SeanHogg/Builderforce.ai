/**
 * Basis object — a structured, explanation for what a payload represents, why it was sent,
 * and how to interpret its fields. This is carried alongside any payload so that
 * orchestrators, agents, and UI can reason about it without inferring meaning from raw bytes.
 *
 * The canonical schema version is 1.0. The system supports current schema + one prior minor version
 * (e.g., 1.0, 0.1). Auto-migration runs on ingestion; if a payload cannot be migrated, it is
 * treated as BASIS_INVALID.
 *
 * CRUD: this file contains the domain types and pure validation/migration logic (IO-free).
 * Stateful operations (persistence, fetching, events) live in api/src/application/payload/basisService.ts.
 */

import { ValidationError } from '../shared/errors.js';
import { parseJsonObject } from '../shared/json.js';

/** Public exported invariants and constants */
export const PAYLOAD_BASIS_SCHEMA_CURRENT = '1.0';
export const PAYLOAD_BASIS_SCHEMA_PREV = '0.1';

/** The canonical schema artifacts: version numbers and their semantic version strings */
export const PAYLOAD_BASIS_VERSIONS = [PAYLOAD_BASIS_SCHEMA_PREV, PAYLOAD_BASIS_SCHEMA_CURRENT] as const;

export type PayloadBasisSchemaVersion = (typeof PAYLOAD_BASIS_VERSIONS)[number];
export const isValidPayloadBasisSchemaVersion = (v: string): v is PayloadBasisSchemaVersion =>
  PAYLOAD_BASIS_VERSIONS.includes(v as PayloadBasisSchemaVersion);

/**
 * Confidence score — claimed accuracy/completeness of the payload by its originator.
 * Range [0, 1].
 */
export type Confidence = number;

/**
 * Confidence breakpoints used by the UI for color-coded indicators.
 */
export const CONFIDENCE_BREAKPOINTS = {
  green: 0.8,  // ≥0.8
  yellow: 0.5, // 0.5–0.79
  red: 0,      // <0.5
} as const;

/**
 * Confidence indicator type for the frontend.
 * 'high' only set on 1.0 payloads; prior versions are treated as "at-risk/high" until client-side upgrade.
 */
export type ConfidenceIndicator = 'high' | 'yellow' | 'red';

/** Field-level glossary entry. */
export interface GlossaryEntry {
  description: string;
}

/**
 * Standard higher-order fields visible in both prior and current schema.
 * Fields described here must be present and valid in all supported versions.
 */
export const STANDARD_FIELDS = [
  'id',
  'schema_version',
  'origin',
  'created_at',
  'intent',
  'domain',
  'field_glossary',
  'constraints',
  'confidence',
] as const;

type KnownFields = typeof STANDARD_FIELDS[number];

/** Errors thrown during validation & migration. */
export class MissingRequiredFieldError extends ValidationError {
  constructor(field: string) {
    super(`Missing required field: "${field}" in payload basis`);
  }
}

export class InvalidFieldTypeError extends ValidationError {
  constructor(field: string, expectedType: string, actualType: string) {
    super(`Invalid field type for "${field}": expected ${expectedType}, got ${actualType}`);
  }
}

export class InvalidConfidenceError extends ValidationError {
  constructor(value: number) {
    super(`Confidence must be a number in [0, 1], got ${value}`);
  }
}

export class SchemaVersionMismatchError extends ValidationError {
  constructor(current: PayloadBasisSchemaVersion, provided: string) {
    super(
      `Schema version mismatch: payload basis is marked as version "${provided}", which the system does not support. Supported versions: ${PAYLOAD_BASIS_VERSIONS.join(', ')}. A migration path is not configured for this version.`,
    );
  }
}

export class FieldGlossaryRequiredError extends ValidationError {
  constructor() {
    super('field_glossary is required and must be an object.');
  }
}

/**
 * Common artifact used to indicate the current schema (1.0) is upgraded to 1.0 artificially
 * (no machine-readable change at runtime).
 */
export class LiftFromMinorVersionError extends ValidationError {
  constructor(migratedFrom: string) {
    super(`Lifted payload basis from prior schema version "${migratedFrom}" to current schema (no change).`);
  }
}

/**
 * Errors returned when a payload basis cannot be accepted.
 */
export enum BasisStatus {
  /** Payload basis is missing entirely. */
  MISSING_BASIS = 'missing_basis',
  /** Payload basis is invalid (validation error, unknown schema version, bad type). */
  BASIS_INVALID = 'basis_invalid',
  /** Payload basis is accepted after successfully migrating from a prior minor version. */
  MIGRATED = 'migrated',
}

/** Mutation from ingestion failures to core BuildingForce domains. */
export interface BasisIngestResult {
  status: BasisStatus.MISSING_BASIS | BasisStatus.BASIS_INVALID;
  error: string;
}

/** Mutation from ingestion after schema upgrade to core BuildingForce domains. */
export interface BasisIngestMigratedResult {
  status: BasisStatus.MIGRATED;
  schemaVersion: PayloadBasisSchemaVersion;
  liftedFrom: PayloadBasisSchemaVersion;
}

/** Mutation from successful ingestion to core BuildingForce domains. */
export interface BasisIngestAcceptedResult {
  status: 'accepted';
  basis: PayloadBasisV1;
}

/** Variant mutation type from ingestion gateways. */
export type BasisIngestResult =
  | BasisIngestResult
  | BasisIngestMigratedResult
  | BasisIngestAcceptedResult;

/**
 * Determines the human-facing confidence indicator based on the declared confidence.
 * Accepts a known current-schema confidence (1.0) or, as a heuristic, accepts any positive float
 * measured against the 1.0 thresholds (meaning the prior schema is treated as 'at-risk/high').
 */
export function getConfidenceIndicator(confidence: number): ConfidenceIndicator {
  if (confidence >= CONFIDENCE_BREAKPOINTS.green) return 'high';
  if (confidence >= CONFIDENCE_BREAKPOINTS.yellow) return 'yellow';
  return 'red';
}

/**
 * Validates the presence and type of required standard fields present on both current and prior schema.
 */
function validateStandardFields(root: unknown): KnownFields[] {
  const required = STANDARD_FIELDS;
  const missing: KnownFields[] = [];
  for (const field of required) {
    if (!(field in root) || root[field] == null) {
      missing.push(field);
    }
  }
  return missing;
}

/**
 * Type guard for confidence values, enabling strict property access on validated payloads.
 */
export function isConfidence(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 1;
}

/**
 * Guesses domain values from 'intent' strings (code_review, data_analysis, etc.) to fulfill UI role tag needs.
 * This is a mechanical heuristic; it does NOT guarantee interoperability to external systems.
 */
export function guessDomainFromIntent(intent: string): string {
  if (!intent || typeof intent !== 'string') return 'unknown';
  const lower = intent.toLowerCase().trim();
  // Low effort: fuzzy string matching on common keywords.
  if (lower.includes('review') || lower.includes('code check')) return 'code_review';
  if (lower.includes('analysis') || lower.includes('inspect')) return 'data_analysis';
  if (lower.includes('repair') || lower.includes('fix')) return 'bug_fix';
  if (lower.includes('deploy') || lower.includes('release')) return 'release_management';
  if (lower.includes('policy') || lower.includes('rule')) return 'policy_check';
  if (lower.includes('audit') || lower.includes('compliance')) return 'audit';
  if (lower.includes('security') || lower.includes('vuln')) return 'security';
  if (lower.includes('plan') || lower.includes('schedule')) return 'planning';
  if (lower.includes('skills')) return 'agent_skills';
  if (lower.includes('experiment')) return 'experimentation';
  if (lower.includes('marketplace')) return 'marketplace';
  return 'unknown';
}

/**
 * Validates a field_glossary object. It must contain a key for every known field, each entry required to have a 'description'.
 */
export function validateFieldGlossary(glossary: unknown): KnownFields[] {
  if (typeof glossary !== 'object' || glossary == null || Array.isArray(glossary)) {
    throw new FieldGlossaryRequiredError();
  }
  const required = STANDARD_FIELDS;
  const missing = [] as KnownFields[];
  for (const field of required) {
    if (!(field in glossary)) missing.push(field);
  }
  return missing;
}

/** Canonical concrete invariants enforcement for 1.0. */
export class PayloadBasisV1 {
  /** Unique identifier for this payload instance. */
  public readonly id: string;
  /** Semver schema version. */
  public readonly schema_version: PayloadBasisSchemaVersion;
  /** Source system or agent that produced the payload. */
  public readonly origin: string;
  /** ISO 8601 timestamp of payload creation. */
  public readonly created_at: string;
  /** Plain-language statement of what this payload asks/represents. */
  public readonly intent: string;
  /** Domain taxonomy (e.g., code_review). */
  public readonly domain: string;
  /** Top-level field -> human description mapping. */
  public readonly field_glossary: Record<string, GlossaryEntry>;
  /** Known limitations or assumptions about the payload data. */
  public readonly constraints: string[];
  /** Originator's declared confidence in payload correctness/completeness. */
  public readonly confidence: Confidence;

  constructor(init: unknown) {
    const raw = parseJsonObject<PayloadBasisV1.Interface>(init);
    // Standard presence check
    const missing = validateStandardFields(raw);
    if (missing.length > 0) {
      throw new MissingRequiredFieldError(missing[0]);
    }
    // Schema version check (must be 1.0 now)
    if (!isValidPayloadBasisSchemaVersion(raw.schema_version)) {
      throw new SchemaVersionMismatchError(PAYLOAD_BASIS_SCHEMA_CURRENT, String(raw.schema_version));
    }
    // Type checks
    if (raw.id == null || typeof raw.id !== 'string') {
      throw new InvalidFieldTypeError('id', 'string', raw.id == null ? 'null/undefined' : typeof raw.id);
    }
    if (!/ISO8601/.test(raw.created_at)) {
      throw new InvalidFieldTypeError('created_at', 'ISO 8601 string', typeof raw.created_at);
    }
    if (raw.origin == null || typeof raw.origin !== 'string') {
      throw new InvalidFieldTypeError('origin', 'string', raw.origin == null ? 'null/undefined' : typeof raw.origin);
    }
    if (raw.intent == null || typeof raw.intent !== 'string') {
      throw new InvalidFieldTypeError('intent', 'string', raw.intent == null ? 'null/undefined' : typeof raw.intent);
    }
    if (raw.domain == null || typeof raw.domain !== 'string') {
      throw new InvalidFieldTypeError('domain', 'string', raw.domain == null ? 'null/undefined' : typeof raw.domain);
    }
    const glossary = raw.field_glossary;
    if (!glossary || typeof glossary !== 'object' || Array.isArray(glossary)) {
      throw new FieldGlossaryRequiredError();
    }
    const glossaryMissing = validateFieldGlossary(glossary);
    if (glossaryMissing.length > 0) {
      throw new MissingRequiredFieldError(glossaryMissing[0]);
    }
    // Confidence validation
    if (!isConfidence(raw.confidence)) {
      throw new InvalidConfidenceError(raw.confidence);
    }

    Object.assign(this, raw);
  }
}

/** Public exports for imports. */
export const PayloadBasis = {
  /** Validates and binds a 1.0 schema basis. */
  fromV1: (init: unknown) => new PayloadBasisV1(init),

  /** Public interface for copy operations and documentation. */
  Interface: PayloadBasisV1,

  /** Confidence output for UI. */
  getConfidenceIndicator,

  /** Granular domain guessing to satisfy UI role tag needs. */
  guessDomainFromIntent,

  /** Boundaries for comprehension by consumers that infer intent from 'domain'. */
  standardFields: STANDARD_FIELDS,

  /** Errors. */
  BASIS_STATUS: BasisStatus,
};