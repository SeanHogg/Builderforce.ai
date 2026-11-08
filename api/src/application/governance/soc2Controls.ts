/**
 * soc2Controls — the writes behind the SOC 2 control routes (a control's status patch and manually
 * attached evidence), so the route handlers hold no table access. Every function is scoped by
 * `(tenantId, segmentId)`; the route audits the result through the governance mutation envelope.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { socControls, socEvidence } from '../../infrastructure/database/schema';
import type { SegmentScope } from '../shared/segmentScope';
import { RESERVED_EVIDENCE_TYPES } from './automatedSocEvidence';

export const CONTROL_STATUSES = ['not_started', 'in_progress', 'ready', 'out_of_scope'] as const;
export type ControlStatus = (typeof CONTROL_STATUSES)[number];
export const isControlStatus = (v: unknown): v is ControlStatus =>
  typeof v === 'string' && (CONTROL_STATUSES as readonly string[]).includes(v);

export interface ControlPatch { status?: ControlStatus; ownerId?: string | null; notes?: string | null }

const controlInScope = (scope: SegmentScope, id: string) =>
  and(eq(socControls.id, id), eq(socControls.tenantId, scope.tenantId), eq(socControls.segmentId, scope.segmentId));

/** Patch a control. Returns the row before and after, or null when it is not in this segment. */
export async function patchSocControl(db: Db, scope: SegmentScope, id: string, patch: ControlPatch) {
  const [before] = await db.select().from(socControls).where(controlInScope(scope, id)).limit(1);
  if (!before) return null;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.ownerId !== undefined) set.ownerId = patch.ownerId;
  if (patch.notes !== undefined) set.notes = patch.notes;
  const [updated] = await db.update(socControls).set(set).where(controlInScope(scope, id)).returning();
  return updated ? { before, updated } : null;
}

export type AttachEvidenceResult =
  | { ok: true; evidence: typeof socEvidence.$inferSelect }
  | { ok: false; reason: 'control_not_found' | 'reserved_type' };

/**
 * Attach MANUAL evidence. The types the platform writes itself (`automated`, `override`) are refused:
 * a person must not be able to file hand-typed evidence as an automated record of a scan.
 */
export async function attachManualEvidence(
  db: Db, scope: SegmentScope, controlId: string,
  input: { title: string; evidenceType: string; url?: string | null; note?: string | null },
): Promise<AttachEvidenceResult> {
  if (RESERVED_EVIDENCE_TYPES.includes(input.evidenceType.trim().toLowerCase())) return { ok: false, reason: 'reserved_type' };
  const [control] = await db.select({ id: socControls.id }).from(socControls).where(controlInScope(scope, controlId)).limit(1);
  if (!control) return { ok: false, reason: 'control_not_found' };
  const [evidence] = await db.insert(socEvidence).values({
    tenantId: scope.tenantId, segmentId: scope.segmentId, controlId,
    title: input.title.trim(), evidenceType: input.evidenceType.trim(),
    url: input.url ?? null, note: input.note ?? null,
  }).returning();
  return evidence ? { ok: true, evidence } : { ok: false, reason: 'control_not_found' };
}
