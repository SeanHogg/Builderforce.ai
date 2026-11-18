/**
 * findingIncidentKinds — the ONE seam through which the platform opens `security_incidents` on its
 * own (make.md › PRD 31 §4 W10 design decision 9; run.md › PRD 08).
 *
 * A KIND is a data entry: its `source_ref` prefix (the dedupe key), its detection source, its
 * severity floor, its provenance and its title/impact mapping. {@link openKindIncident} is the one
 * writer every kind goes through, so idempotency, reopen-on-recurrence and the governance audit are
 * written once. Adding a kind = one entry in {@link FindingKindSubjects} + {@link FINDING_KINDS},
 * plus widening the unique index (and {@link PLATFORM_INCIDENT_REF_PREDICATE}) in a migration —
 * the test suite fails while a prefix is not covered.
 *
 *   finding  `finding:<owner/repo>:<fingerprint>`               agent           floor critical   (mig 1321)
 *   shield   `shield:<projectId>:<applicationId>:<ruleId>`      runtime-shield  floor high       (mig 1354)
 *
 * IDEMPOTENT PER REF. `uq_security_incidents_platform_ref` makes `(tenant_id, segment_id,
 * source_ref)` unique — NULLS NOT DISTINCT — for every registered prefix. The conflict target always
 * carries `tenant_id`, so a ref can only ever collide with the SAME tenant's incident.
 *
 * A RECURRENCE REOPENS. A resolved/closed incident whose ref comes back is set to `open` again with a
 * dated line appended to `impact`; one that is open or in progress is left exactly as it is.
 */
import { sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { securityIncidents } from '../../infrastructure/database/schema';
import type { ActorIdentity } from '../activity/activityLog';
import { recordGovernanceMutation } from '../governance/mutationAudit';
import { SHIELD_BLOCKING_ACTIONS, type RuntimeShieldEvent } from './runtimeShieldEvent';

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

/** True when `severity` is at or above `floor`. */
export function meetsSeverityFloor(severity: IncidentSeverity, floor: IncidentSeverity): boolean {
  return INCIDENT_SEVERITIES.indexOf(severity) >= INCIDENT_SEVERITIES.indexOf(floor);
}

/** `security_incidents.attestation` — null when the platform detected it itself. */
export type IncidentAttestation = 'client-attested';

/**
 * The predicate of `uq_security_incidents_platform_ref`, VERBATIM. Postgres picks the arbiter of an
 * `ON CONFLICT` by columns AND predicate, so every kind's upsert restates exactly this.
 */
export const PLATFORM_INCIDENT_REF_PREDICATE = `(source_ref LIKE 'finding:%' OR source_ref LIKE 'shield:%')`;

/** A CRITICAL vulnerability finding of a scan (vulnerability_findings). */
export interface CriticalFindingForIncident {
  id: string;
  title: string;
  fingerprint: string | null;
  filePath: string | null;
  scanId: string;
}

/** What each kind is opened FOR. */
export interface FindingKindSubjects {
  finding: {
    finding: CriticalFindingForIncident;
    /** `owner/repo` the finding is in; part of the dedupe key. */
    repoRef: string;
    /** Where it was found, e.g. the PR url. */
    where: string | null;
  };
  shield: RuntimeShieldEvent;
}
export type FindingKindName = keyof FindingKindSubjects;

export interface FindingKind<S> {
  /** `source_ref` is `<refPrefix>:<refKey(subject)>`. */
  readonly refPrefix: string;
  readonly detectionSource: string;
  /** Below this the subject never opens an incident. */
  readonly severityFloor: IncidentSeverity;
  readonly attestation: IncidentAttestation | null;
  readonly refKey: (subject: S) => string;
  readonly severity: (subject: S) => IncidentSeverity;
  /** Beyond the floor: does this subject warrant an incident at all (e.g. only a block, never a probe)? */
  readonly opens: (subject: S) => boolean;
  readonly title: (subject: S) => string;
  readonly impact: (subject: S) => string;
  /** The dated line appended when a resolved incident recurs. */
  readonly recurrence: (subject: S) => string;
  readonly evidence: (subject: S) => Record<string, unknown> | null;
}

const SHIELD_ACTION_VERB: Record<string, string> = { reject: 'blocked', quarantine: 'quarantined' };

export const FINDING_KINDS: { readonly [K in FindingKindName]: FindingKind<FindingKindSubjects[K]> } = {
  finding: {
    refPrefix: 'finding',
    detectionSource: 'agent',
    severityFloor: 'critical',
    attestation: null,
    refKey: ({ finding, repoRef }) => `${repoRef}:${finding.fingerprint ?? `id:${finding.id}`}`,
    severity: () => 'critical',
    opens: () => true,
    title: ({ finding }) => `CRITICAL finding: ${finding.title}`,
    impact: ({ finding, where }) => `A CRITICAL security finding was detected${finding.filePath ? ` in ${finding.filePath}` : ''}${where ? ` (${where})` : ''}. `
      + 'The merge is held until the finding is fixed or its risk is explicitly accepted.',
    recurrence: ({ where }) => `The finding recurred${where ? ` (${where})` : ''}; incident reopened.`,
    evidence: () => null,
  },
  shield: {
    refPrefix: 'shield',
    detectionSource: 'runtime-shield',
    severityFloor: 'high',
    attestation: 'client-attested',
    refKey: (e) => `${e.projectId}:${e.applicationId}:${e.ruleId}`,
    severity: (e) => e.severity,
    // A quarantine or a signature/boundary block; monitor/throttle/allow are probes.
    opens: (e) => SHIELD_BLOCKING_ACTIONS.has(e.action),
    title: (e) => `Runtime shield ${SHIELD_ACTION_VERB[e.action] ?? e.action}: ${e.ruleId} (${e.reasonCode})`,
    impact: (e) => `The browser runtime's Security Shield ${SHIELD_ACTION_VERB[e.action] ?? e.action} service "${e.serviceId}" `
      + `of application "${e.applicationId}" in project ${e.projectId}: ${e.category} rule ${e.ruleId}, reason ${e.reasonCode}. `
      + `Client-attested: reported by the runtime at ${e.occurredAt} and not verified by the server.`,
    recurrence: (e) => `The runtime shield ${SHIELD_ACTION_VERB[e.action] ?? e.action} it again (${e.reasonCode}, reported at ${e.occurredAt}); incident reopened.`,
    evidence: (e) => e.evidence,
  },
};

export interface KindIncidentContext {
  tenantId: number;
  segmentId: string;
}

/** The incident row for a subject of `kind`. PURE - the same subject always yields the same `sourceRef`. */
export function buildKindIncident<K extends FindingKindName>(kind: K, subject: FindingKindSubjects[K], ctx: KindIncidentContext) {
  const spec: FindingKind<FindingKindSubjects[K]> = FINDING_KINDS[kind];
  return {
    tenantId: ctx.tenantId,
    segmentId: ctx.segmentId,
    title: spec.title(subject).slice(0, 255),
    severity: spec.severity(subject),
    status: 'open',
    detectionSource: spec.detectionSource,
    impact: spec.impact(subject),
    sourceRef: `${spec.refPrefix}:${spec.refKey(subject)}`,
    attestation: spec.attestation,
    evidence: spec.evidence(subject),
  };
}

/** Whether a subject of `kind` opens an incident: at or above the kind's floor AND the kind's own rule. */
export function kindOpensIncident<K extends FindingKindName>(kind: K, subject: FindingKindSubjects[K]): boolean {
  const spec: FindingKind<FindingKindSubjects[K]> = FINDING_KINDS[kind];
  return meetsSeverityFloor(spec.severity(subject), spec.severityFloor) && spec.opens(subject);
}

/** `opened` covers a new incident and a reopened one; `deduplicated` = already open for this ref; `ignored` = below the floor / a probe. */
export type KindIncidentOutcome =
  | { outcome: 'opened'; incidentId: string }
  | { outcome: 'deduplicated' }
  | { outcome: 'ignored' };

/**
 * Open (or reopen) the incident for one subject of `kind`, through the dedupe index, and record it in
 * the governance mutation-audit trail. `note` is extra audit context (finding id, scan id …).
 */
export async function openKindIncident<K extends FindingKindName>(
  env: Env | undefined, db: Db, actor: ActorIdentity, kind: K, subject: FindingKindSubjects[K],
  ctx: KindIncidentContext, note?: Record<string, unknown>,
): Promise<KindIncidentOutcome> {
  if (!kindOpensIncident(kind, subject)) return { outcome: 'ignored' };
  const spec: FindingKind<FindingKindSubjects[K]> = FINDING_KINDS[kind];
  const row = buildKindIncident(kind, subject, ctx);
  const written = await db.insert(securityIncidents).values(row)
    .onConflictDoUpdate({
      // tenant_id is part of the target: a ref only ever collides with the same tenant's incident.
      target: [securityIncidents.tenantId, securityIncidents.segmentId, securityIncidents.sourceRef],
      // The unique index is PARTIAL; the conflict target must restate its predicate verbatim.
      targetWhere: sql.raw(PLATFORM_INCIDENT_REF_PREDICATE),
      set: {
        status: 'open',
        resolvedAt: null,
        updatedAt: new Date(),
        impact: sql`COALESCE(${securityIncidents.impact}, '') || ${`\n[${new Date().toISOString().slice(0, 10)}] ${spec.recurrence(subject)}`}`,
        evidence: sql`COALESCE(excluded.evidence, ${securityIncidents.evidence})`,
      },
      // Only a RESOLVED / CLOSED incident reopens. One that is open - or in any in-progress state
      // (investigating, mitigating ...) - is being worked and is left exactly as it is.
      setWhere: sql`${securityIncidents.status} IN ('resolved', 'closed')`,
    })
    .returning({ id: securityIncidents.id });
  const incidentId = written[0]?.id;
  if (!incidentId) return { outcome: 'deduplicated' };
  await recordGovernanceMutation(env, db, {
    actor, tenantId: ctx.tenantId, segmentId: ctx.segmentId, entity: 'incidents', entityId: incidentId, action: 'open',
    after: row, note,
  });
  return { outcome: 'opened', incidentId };
}
