/**
 * runtimeShieldEvent — the Builderforce side of the browser runtime's `SecurityEvent` contract
 * (make.md › PRD 31 §4 W10; `@seanhogg/builderforce-webcontainers/security`).
 *
 * The runtime emits reason codes only and stays independent of Builderforce; its
 * `SecurityEventSink` adapter posts each incident-worthy event to
 * `POST /api/security/shield-incidents`. The value sets below mirror the runtime's
 * (`ShieldReasonCode` in `core/src/system/securityContext.ts`) — a code the runtime adds is
 * refused here until it is added to this list, so an unknown code can never reach an incident.
 *
 * Everything in an event is CLIENT-ATTESTED: the browser reported it and the server cannot
 * verify it. Evidence is already redacted by the runtime; {@link findForbiddenEvidenceKey} is
 * the server's refusal of anything that still looks like a credential.
 */
import type { IncidentSeverity } from './findingIncidentKinds';

export const SHIELD_CATEGORIES = ['ingress', 'network', 'process', 'filesystem', 'database', 'resource'] as const;
export type ShieldCategory = (typeof SHIELD_CATEGORIES)[number];

export const SHIELD_REASON_CODES = [
  'port.not_owner',
  'port.edge_not_declared',
  'db.auth_failed',
  'db.not_owner',
  'db.service_not_allowed',
  'process.spawn_quota',
  'process.depth_quota',
  'fs.outside_app',
  'fs.protected_path',
  'fs.invalid_op',
  'ingress.body_too_large',
  'ingress.client_not_bound',
  'ingress.attach_rejected',
] as const;
export type ShieldReasonCode = (typeof SHIELD_REASON_CODES)[number];

/** The runtime's `SecurityDecision.action`. */
export const SHIELD_ACTIONS = ['allow', 'monitor', 'throttle', 'reject', 'quarantine'] as const;
export type ShieldAction = (typeof SHIELD_ACTIONS)[number];

/** Actions that stopped something — a signature/boundary block (`reject`) or a quarantine. Everything else is a probe. */
export const SHIELD_BLOCKING_ACTIONS: ReadonlySet<ShieldAction> = new Set<ShieldAction>(['reject', 'quarantine']);

/** One incident-worthy event as the runtime's sink adapter reports it. */
export interface RuntimeShieldEvent {
  category: ShieldCategory;
  ruleId: string;
  severity: IncidentSeverity;
  reasonCode: ShieldReasonCode;
  action: ShieldAction;
  applicationId: string;
  serviceId: string;
  projectId: number;
  /** Redacted evidence — never passwords, tokens, cookies or full bodies. */
  evidence: Record<string, unknown>;
  /** When the runtime saw it (ISO-8601) — client time, recorded as reported, never trusted for ordering. */
  occurredAt: string;
}

/** Serialized evidence above this is refused: evidence is a pointer for the operator, not a payload. */
export const SHIELD_EVIDENCE_MAX_BYTES = 4096;
/** Nesting deeper than this is refused (bounded inspection on the server too). */
export const SHIELD_EVIDENCE_MAX_DEPTH = 4;

/** A key that names a credential. Matched anywhere in the key, case-insensitively. */
const FORBIDDEN_EVIDENCE_KEY = /pass(?:word|wd)?|pwd|token|cookie|secret|authori[sz]ation|api[-_]?key|credential|private[-_]?key/i;

/**
 * The dotted path of the first key in `value` that names a credential, or of the first object
 * nested deeper than {@link SHIELD_EVIDENCE_MAX_DEPTH}; null when the evidence is clean.
 * PURE. Arrays are walked; their indexes are path segments.
 */
export function findForbiddenEvidenceKey(value: unknown, path: string[] = []): string | null {
  if (value === null || typeof value !== 'object') return null;
  if (path.length > SHIELD_EVIDENCE_MAX_DEPTH) return path.join('.');
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  for (const [key, child] of entries) {
    if (!Array.isArray(value) && FORBIDDEN_EVIDENCE_KEY.test(key)) return [...path, key].join('.');
    const nested = findForbiddenEvidenceKey(child, [...path, key]);
    if (nested) return nested;
  }
  return null;
}

/** Bytes of the evidence as it will be stored (UTF-8 JSON). */
export function evidenceByteLength(evidence: unknown): number {
  return new TextEncoder().encode(JSON.stringify(evidence)).length;
}
