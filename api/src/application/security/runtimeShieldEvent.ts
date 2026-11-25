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
 * the server's refusal of anything that still looks like a credential. It checks KEYS only: a
 * credential smuggled as the VALUE of a benign key (`{ note: 'Bearer …' }`) is not detected — the
 * runtime's redaction is the control for values, and the size cap bounds what can ride along.
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
  'ingress.same_origin_refused',
  'ingress.preview_origin_invalid',
  'ingress.app_origin_mismatch',
  'ingress.app_origin_required',
  'ingress.shared_preview_origin',
  'ingress.handoff_conflict',
  'egress.policy_invalid',
  'process.message_undeliverable',
  'agent.tool_not_allowed',
  'agent.path_invalid',
  'agent.service_not_allowed',
  'code.blocked',
  'code.scan_incomplete',
] as const;
export type ShieldReasonCode = (typeof SHIELD_REASON_CODES)[number];

/** What the SERVER says a reason code means — never what the client claimed. */
export interface ShieldReasonPolicy {
  /** The incident's severity. The `shield` kind's floor is `high`, so a `medium`/`low` code never opens an incident. */
  readonly severity: IncidentSeverity;
  /** The rule the incident is deduped on (`shield:<projectId>:<applicationId>:<ruleId>`). */
  readonly ruleId: string;
}

/**
 * The server-side severity and rule of every reason code. The client's `severity` and `ruleId` are
 * recorded as evidence only: trusting them would let a client raise any event to an incident, and
 * mint an unbounded number of distinct dedupe refs by varying `ruleId`.
 *
 * How the severities were chosen:
 *  - HIGH — the event is an isolation boundary being crossed or forced: another application's port,
 *    database or files (`port.not_owner`, `db.not_owner`, `fs.outside_app`), a protected path or a
 *    database the service is not granted (`fs.protected_path`, `db.service_not_allowed`), a failed
 *    database authentication (`db.auth_failed`), and an ingress client that is not bound to the
 *    application or an attach the runtime refused (`ingress.client_not_bound`, `ingress.attach_rejected`),
 *    and a request that reached an application's port through another application's preview origin
 *    (`ingress.app_origin_mismatch`).
 *  - MEDIUM — resource and quota limits and an undeclared edge (`process.spawn_quota`,
 *    `process.depth_quota`, `ingress.body_too_large`, `port.edge_not_declared`): usually a bug or a
 *    misconfiguration in the app, already contained by the runtime; telemetry, not an incident. So are
 *    the embedder-configuration refusals — a same-origin preview, an invalid or missing per-application
 *    preview origin, a malformed egress policy id (`ingress.same_origin_refused`,
 *    `ingress.preview_origin_invalid`, `ingress.app_origin_required`, `egress.policy_invalid`) — and a
 *    cross-origin message the runtime could not deliver (`process.message_undeliverable`), and a second
 *    application's attach refused because another one already holds the shared preview
 *    (`ingress.handoff_conflict`, the runtime's own `medium`): each is
 *    Builderforce's own setup refused safely, not an attack.
 *  - LOW — a malformed filesystem operation (`fs.invalid_op`): the runtime refused bad input. And the
 *    one notice that refuses nothing (`ingress.shared_preview_origin`, action `monitor`).
 *  - Nothing is CRITICAL: every report is client-attested and unverified, so the server never lets one
 *    claim the top severity; a critical incident comes from a source the server observed itself.
 */
export const SHIELD_REASON_POLICY: { readonly [C in ShieldReasonCode]: ShieldReasonPolicy } = {
  'port.not_owner': { severity: 'high', ruleId: 'shield.port.not-owner' },
  'port.edge_not_declared': { severity: 'medium', ruleId: 'shield.port.edge-not-declared' },
  'db.auth_failed': { severity: 'high', ruleId: 'shield.db.auth-failed' },
  'db.not_owner': { severity: 'high', ruleId: 'shield.db.not-owner' },
  'db.service_not_allowed': { severity: 'high', ruleId: 'shield.db.service-not-allowed' },
  'process.spawn_quota': { severity: 'medium', ruleId: 'shield.process.spawn-quota' },
  'process.depth_quota': { severity: 'medium', ruleId: 'shield.process.depth-quota' },
  'fs.outside_app': { severity: 'high', ruleId: 'shield.fs.outside-app' },
  'fs.protected_path': { severity: 'high', ruleId: 'shield.fs.protected-path' },
  'fs.invalid_op': { severity: 'low', ruleId: 'shield.fs.invalid-op' },
  'ingress.body_too_large': { severity: 'medium', ruleId: 'shield.ingress.body-too-large' },
  'ingress.client_not_bound': { severity: 'high', ruleId: 'shield.ingress.client-not-bound' },
  'ingress.attach_rejected': { severity: 'high', ruleId: 'shield.ingress.attach-rejected' },
  'ingress.same_origin_refused': { severity: 'medium', ruleId: 'shield.ingress.same-origin-refused' },
  'ingress.preview_origin_invalid': { severity: 'medium', ruleId: 'shield.ingress.preview-origin-invalid' },
  'ingress.app_origin_mismatch': { severity: 'high', ruleId: 'shield.ingress.app-origin-mismatch' },
  'ingress.app_origin_required': { severity: 'medium', ruleId: 'shield.ingress.app-origin-required' },
  'ingress.shared_preview_origin': { severity: 'low', ruleId: 'shield.ingress.shared-preview-origin' },
  'ingress.handoff_conflict': { severity: 'medium', ruleId: 'shield.ingress.handoff-conflict' },
  'egress.policy_invalid': { severity: 'medium', ruleId: 'shield.egress.policy-invalid' },
  'process.message_undeliverable': { severity: 'medium', ruleId: 'shield.process.message-undeliverable' },
  'agent.tool_not_allowed': { severity: 'medium', ruleId: 'shield.agent.tool-allowlist' },
  'agent.path_invalid': { severity: 'high', ruleId: 'shield.agent.workspace-path' },
  'agent.service_not_allowed': { severity: 'high', ruleId: 'shield.agent.own-services' },
  // The code scanner refused malicious code (client-attested, so high, never critical); `code.scan_incomplete` is monitor-only telemetry.
  'code.blocked': { severity: 'high', ruleId: 'shield.code.blocked' },
  'code.scan_incomplete': { severity: 'low', ruleId: 'shield.code.scan-incomplete' },
};

/**
 * Open client-attested shield incidents one project may hold. Past it a report is ignored (202
 * `reason: 'cap'`): `applicationId` is client-minted, so the per-rule dedupe alone cannot bound
 * how many incidents one project's runtime can open.
 */
export const SHIELD_OPEN_INCIDENTS_PER_PROJECT = 50;

/** The runtime's `SecurityDecision.action`. */
export const SHIELD_ACTIONS = ['allow', 'monitor', 'throttle', 'reject', 'quarantine'] as const;
export type ShieldAction = (typeof SHIELD_ACTIONS)[number];

/** Actions that stopped something — a signature/boundary block (`reject`) or a quarantine. Everything else is a probe. */
export const SHIELD_BLOCKING_ACTIONS: ReadonlySet<ShieldAction> = new Set<ShieldAction>(['reject', 'quarantine']);

/** One incident-worthy event as the runtime's sink adapter reports it. */
export interface RuntimeShieldEvent {
  category: ShieldCategory;
  /** The client's rule — recorded as evidence only; the incident dedupes on {@link SHIELD_REASON_POLICY}'s rule. */
  ruleId: string;
  /** The client's severity — recorded as evidence only; the incident's severity is {@link SHIELD_REASON_POLICY}'s. */
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

/**
 * A key that names a credential, case-insensitively. Most terms match anywhere in the key; a bare
 * `pass` must stand alone or between separators (`pass`, `db_pass`, `pass-hash`) so that words that
 * merely contain it (`bypass`, `compass`, `passage`) are not refused.
 */
const FORBIDDEN_EVIDENCE_KEY = /password|passwd|passphrase|pwd|(?:^|[^a-z])pass(?:[^a-z]|$)|token|cookie|secret|authori[sz]ation|api[-_]?key|credential|private[-_]?key/i;

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
