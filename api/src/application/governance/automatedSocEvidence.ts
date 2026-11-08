/**
 * automatedSocEvidence — SOC 2 evidence the platform writes ITSELF (PRD 08 §4.4 / §10): "every code
 * change went through review + scan", with `sourceRef` recording provenance.
 *
 *   merged pull request     -> CC8.1 (change management)
 *   security scan finished  -> CC7.1 (vulnerability detection) and CC8.1
 *   security review done    -> CC8.1
 *
 * IDEMPOTENT. `source_ref` is `auto:<kind>:<id>` and migration 1321 makes `(control_id, source_ref)`
 * unique for that prefix, so a retried finalize, an overlapping sweep or a second merge path for the
 * same PR writes the row once. The row is `evidence_type = 'automated'`; the manual route (any other
 * type) is unchanged.
 *
 * Best-effort by contract: evidence is a record OF a change, never a condition OF it, so a failure
 * here is reported and swallowed rather than failing a merge or a finalize.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { socControls, socEvidence } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { SYSTEM_ACTOR } from '../activity/activityLog';
import { ensureSoc2Baseline } from './soc2Baseline';
import { recordGovernanceMutation } from './mutationAudit';

export type AutomatedEvidenceKind = 'merge' | 'scan' | 'review' | 'override';
export const AUTOMATED_EVIDENCE_TYPE = 'automated';
/** Written by the platform (a manager's accepted-risk override), recorded as exactly that - never as a clean scan. */
export const OVERRIDE_EVIDENCE_TYPE = 'override';
/** Evidence types only the platform may write: the manual evidence route refuses them. */
export const RESERVED_EVIDENCE_TYPES: readonly string[] = [AUTOMATED_EVIDENCE_TYPE, OVERRIDE_EVIDENCE_TYPE];
export const AUTOMATED_UPLOADER = 'system:devsecops';

const CONTROLS_BY_KIND: Readonly<Record<AutomatedEvidenceKind, readonly string[]>> = {
  merge: ['CC8.1'],
  scan: ['CC7.1', 'CC8.1'],
  review: ['CC8.1'],
  override: ['CC8.1'],
};

export const controlRefsForEvidence = (kind: AutomatedEvidenceKind): readonly string[] => CONTROLS_BY_KIND[kind];

export const automatedSourceRef = (kind: AutomatedEvidenceKind, id: string): string => `auto:${kind}:${id}`;

const TITLES: Record<AutomatedEvidenceKind, string> = {
  merge: 'Change merged through the governed pipeline',
  scan: 'Automated security scan of a change',
  review: 'Automated security review of a change',
  override: 'Security risk of a change accepted by a manager (override)',
};

export interface AutomatedEvidenceInput {
  tenantId: number;
  segmentId: string | null;
  kind: AutomatedEvidenceKind;
  /** The provenance id: PR row id for a merge, scan id for a scan / review. */
  sourceId: string;
  /** PR url, when there is one. */
  url?: string | null;
  /** Provenance in words: run id, PR url / number, scan ids, outcome. The stable key is `source_ref`. */
  note?: string | null;
}

/** Write the evidence rows for one event. Returns how many NEW rows were written. */
export async function recordAutomatedEvidence(env: Env | undefined, db: Db, input: AutomatedEvidenceInput): Promise<number> {
  try {
    if (!input.segmentId) return 0;
    await ensureSoc2Baseline(db, input.tenantId, input.segmentId);
    const controls = await db
      .select({ id: socControls.id, controlRef: socControls.controlRef })
      .from(socControls)
      .where(and(
        eq(socControls.tenantId, input.tenantId),
        eq(socControls.segmentId, input.segmentId),
        inArray(socControls.controlRef, [...CONTROLS_BY_KIND[input.kind]]),
      ));

    let written = 0;
    for (const control of controls) {
      const sourceRef = automatedSourceRef(input.kind, input.sourceId);
      const rows = await db.insert(socEvidence).values({
        tenantId: input.tenantId,
        segmentId: input.segmentId,
        controlId: control.id,
        title: TITLES[input.kind],
        evidenceType: input.kind === 'override' ? OVERRIDE_EVIDENCE_TYPE : AUTOMATED_EVIDENCE_TYPE,
        url: input.url ?? null,
        note: input.note ?? null,
        uploadedBy: AUTOMATED_UPLOADER,
        sourceRef,
      }).onConflictDoNothing().returning({ id: socEvidence.id });
      if (rows.length === 0) continue;
      written += 1;
      if (env) {
        await recordGovernanceMutation(env, db, {
          actor: SYSTEM_ACTOR, tenantId: input.tenantId, segmentId: input.segmentId, entity: 'soc2-evidence',
          entityId: rows[0]!.id, action: 'evidence', after: { controlRef: control.controlRef, sourceRef },
        });
      }
    }
    return written;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/governance/automatedSocEvidence.ts', operation: 'recordAutomatedEvidence',
      context: { tenantId: input.tenantId, kind: input.kind },
    });
    return 0;
  }
}
