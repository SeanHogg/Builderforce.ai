/**
 * Interview kits — the template a loop is run FROM.
 *
 * ── THREE TABLES THAT HAD NO READER AND NO WRITER ────────────────────────────────
 * `interview_kits`, `interview_kit_stages` and `scorecard_attributes` landed with 0419
 * and were referenced by exactly one module: the seat-registration barrel. Nothing read
 * them and nothing wrote them, which made two already-built capabilities unreachable —
 * `interviewScheduling.interviewPanelRefs` reads the panel off a kit stage (so an
 * interview could never have interviewers, so no slot could ever be offered), and the
 * scorecard a decision cites has to be composed of something.
 *
 * ── A KIT IS A TEMPLATE, SO IT HAS A DEFAULT ─────────────────────────────────────
 * `is_default` is honoured rather than merely stored: exactly one kit per tenant carries
 * it, setting it moves it, and {@link ensureDefaultKit} seeds the house loop for a tenant
 * that has never written one. A template surface that opens empty asks a recruiter to
 * design an interview process before they can schedule a call, and what they do instead
 * is run the interview off a document — which is the state this table was supposed to
 * replace.
 *
 * ── STAGES AND SCORECARDS ARE REPLACED, NOT PATCHED ──────────────────────────────
 * `uq_interview_kit_stages_pos` is unique on `(kit_id, position)`, so reordering stages
 * in place collides with itself halfway through the renumber. Replacing the whole list is
 * both simpler and the shape the editor actually posts: a kit is edited as a document.
 * The scorecard attributes attached to each stage go the same way, for the same reason
 * (`uq_scorecard_attributes_key`).
 */

import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  interviewKitStages,
  interviewKits,
  scorecardAttributes,
} from '../../infrastructure/database/schema/hiring';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { AtsError } from './atsError';
import { isUniqueViolation } from '../../infrastructure/database/uniqueViolation';
import {
  DEFAULT_INTERVIEW_KIT_NAME,
  DEFAULT_INTERVIEW_KIT_STAGES,
  isInterviewKitStageKind,
  type InterviewKitStageKind,
} from '../../domain/hiring/pipelineStages';
import type { Env } from '../../env';

export interface ScorecardAttribute {
  key: string;
  label: string;
  weight: number;
  scaleMin: number;
  scaleMax: number;
  position: number;
}

export interface InterviewKitStage {
  id: number;
  name: string;
  kind: InterviewKitStageKind;
  position: number;
  durationMin: number | null;
  /** The scorecard's identity. The QUESTIONS are a canvas `question_sets` row; these are
   *  the DIMENSIONS, which live in `scorecard_attributes` because reports aggregate
   *  across scorecards by attribute. */
  scorecardId: string | null;
  interviewerRefs: string[];
  guidance: string | null;
  scorecard: ScorecardAttribute[];
}

export interface InterviewKit {
  id: number;
  name: string;
  roleFamily: string | null;
  description: string | null;
  isDefault: boolean;
  createdBy: string | null;
  stages: InterviewKitStage[];
}

export interface ScorecardAttributeInput {
  key: string;
  label: string;
  weight?: number;
  scaleMin?: number;
  scaleMax?: number;
}

export interface InterviewKitStageInput {
  name: string;
  kind?: string;
  durationMin?: number | null;
  interviewerRefs?: string[];
  guidance?: string | null;
  /** Reuse an existing scorecard (a canvas object) instead of minting one. */
  scorecardId?: string | null;
  scorecard?: ScorecardAttributeInput[];
}

export interface InterviewKitInput {
  name: string;
  roleFamily?: string | null;
  description?: string | null;
  isDefault?: boolean;
  stages?: InterviewKitStageInput[];
}

const kitsKey = (tenantId: number): string => `hiring:kits:${tenantId}`;

/** Kits change when somebody edits the interview process — days apart, not seconds. The
 *  read happens on every kit editor open AND behind every scheduling call, so it is
 *  exactly the read-heavy/slow-changing shape the cache exists for. */
export async function listInterviewKits(env: Env, db: Db, tenantId: number): Promise<InterviewKit[]> {
  return getOrSetCached(env, kitsKey(tenantId), () => readInterviewKits(db, tenantId), {
    kvTtlSeconds: 600,
    l1TtlMs: 30_000,
  });
}

export async function invalidateInterviewKits(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, kitsKey(tenantId));
}

/**
 * Every kit with its stages and their scorecards — THREE reads, not one per kit.
 *
 * The naive shape is a query per kit for its stages and another per stage for its
 * attributes, which is an N+1 that grows with the number of interviews a company runs.
 * Three set-based reads answer it regardless of size, and a tenant's kit count is small
 * enough that fetching all of them is cheaper than paging.
 */
async function readInterviewKits(db: Db, tenantId: number): Promise<InterviewKit[]> {
  const kits = await db
    .select({
      id: interviewKits.id,
      name: interviewKits.name,
      roleFamily: interviewKits.roleFamily,
      description: interviewKits.description,
      isDefault: interviewKits.isDefault,
      createdBy: interviewKits.createdBy,
    })
    .from(interviewKits)
    .where(scopedToTenant(interviewKits, tenantId));
  if (!kits.length) return [];

  const kitIds = kits.map((kit) => kit.id);
  const stages = await db
    .select({
      id: interviewKitStages.id,
      kitId: interviewKitStages.kitId,
      name: interviewKitStages.name,
      kind: interviewKitStages.kind,
      position: interviewKitStages.position,
      durationMin: interviewKitStages.durationMin,
      scorecardId: interviewKitStages.scorecardId,
      interviewerRefs: interviewKitStages.interviewerRefs,
      guidance: interviewKitStages.guidance,
    })
    .from(interviewKitStages)
    .where(scopedToTenant(interviewKitStages, tenantId, inArray(interviewKitStages.kitId, kitIds)));

  const scorecardIds = stages.flatMap((stage) => (stage.scorecardId ? [stage.scorecardId] : []));
  const attributes = scorecardIds.length
    ? await db
      .select({
        scorecardId: scorecardAttributes.scorecardId,
        key: scorecardAttributes.key,
        label: scorecardAttributes.label,
        weight: scorecardAttributes.weight,
        scaleMin: scorecardAttributes.scaleMin,
        scaleMax: scorecardAttributes.scaleMax,
        position: scorecardAttributes.position,
      })
      .from(scorecardAttributes)
      .where(scopedToTenant(scorecardAttributes, tenantId, inArray(scorecardAttributes.scorecardId, scorecardIds)))
    : [];

  const byScorecard = new Map<string, ScorecardAttribute[]>();
  for (const attribute of attributes) {
    if (!attribute.scorecardId) continue;
    const list = byScorecard.get(attribute.scorecardId) ?? [];
    list.push({
      key: attribute.key,
      label: attribute.label,
      weight: Number(attribute.weight),
      scaleMin: attribute.scaleMin,
      scaleMax: attribute.scaleMax,
      position: attribute.position,
    });
    byScorecard.set(attribute.scorecardId, list);
  }

  const byKit = new Map<number, InterviewKitStage[]>();
  for (const stage of stages) {
    if (stage.kitId == null) continue;
    const list = byKit.get(stage.kitId) ?? [];
    list.push({
      id: stage.id,
      name: stage.name,
      kind: isInterviewKitStageKind(stage.kind) ? stage.kind : 'screen',
      position: stage.position,
      durationMin: stage.durationMin ?? null,
      scorecardId: stage.scorecardId ?? null,
      interviewerRefs: Array.isArray(stage.interviewerRefs)
        ? (stage.interviewerRefs as unknown[]).filter((ref): ref is string => typeof ref === 'string')
        : [],
      guidance: stage.guidance ?? null,
      scorecard: (stage.scorecardId ? byScorecard.get(stage.scorecardId) ?? [] : []).sort((a, b) => a.position - b.position),
    });
    byKit.set(stage.kitId, list);
  }

  return kits
    .map((kit) => ({
      ...kit,
      roleFamily: kit.roleFamily ?? null,
      description: kit.description ?? null,
      createdBy: kit.createdBy ?? null,
      stages: (byKit.get(kit.id) ?? []).sort((a, b) => a.position - b.position),
    }))
    // The default first: it is the one a scheduler reaches for, and a list whose first
    // row is arbitrary makes a reader check every time which one is in force.
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

/**
 * Is this Postgres refusing a duplicate?
 *
 * Matched on the SQLSTATE and on the constraint name in the message, because the driver
 * surfaces the code on some paths and only the text on others. Deliberately narrow: a
 * broad "any insert error means duplicate" would report a lost connection as a naming
 * collision.
 */
function cleanAttributes(inputs: ScorecardAttributeInput[] | undefined): ScorecardAttributeInput[] {
  return (inputs ?? [])
    .map((attribute) => ({
      key: attribute.key.trim().toLowerCase().slice(0, 96),
      label: attribute.label.trim().slice(0, 200),
      weight: attribute.weight,
      scaleMin: attribute.scaleMin,
      scaleMax: attribute.scaleMax,
    }))
    .filter((attribute) => attribute.key && attribute.label);
}

/**
 * Replace a kit's stages and their scorecards.
 *
 * Delete-then-insert rather than a diff. The kit editor posts the whole document, the
 * position index is unique per kit, and a diff would have to renumber through a
 * constraint that forbids two rows sharing a position mid-flight. The stages are
 * cascade-deleted by `kit_id`; the attributes are addressed by their scorecard ids, which
 * have no cascade because a scorecard is a canvas object rather than a child of the kit.
 */
async function replaceStages(
  db: Db,
  tenantId: number,
  kitId: number,
  stages: InterviewKitStageInput[],
): Promise<void> {
  const existing = await db
    .select({ id: interviewKitStages.id, scorecardId: interviewKitStages.scorecardId })
    .from(interviewKitStages)
    .where(scopedToTenant(interviewKitStages, tenantId, eq(interviewKitStages.kitId, kitId)));

  const staleScorecards = existing.flatMap((stage) => (stage.scorecardId ? [stage.scorecardId] : []));
  if (staleScorecards.length) {
    await db
      .delete(scorecardAttributes)
      .where(scopedToTenant(scorecardAttributes, tenantId, inArray(scorecardAttributes.scorecardId, staleScorecards)));
  }
  await db
    .delete(interviewKitStages)
    .where(scopedToTenant(interviewKitStages, tenantId, eq(interviewKitStages.kitId, kitId)));

  for (const [position, stage] of stages.entries()) {
    const name = stage.name.trim().slice(0, 160);
    if (!name) continue;
    const attributes = cleanAttributes(stage.scorecard);
    // A scorecard id is minted when the stage has dimensions and does not already point
    // at one. The uuid is the scorecard's IDENTITY — the same id a `question_sets` object
    // adopts when somebody writes the questions — which is why the column has no foreign
    // key: the dimensions can exist before the questions do.
    const scorecardId = stage.scorecardId?.trim() || (attributes.length ? crypto.randomUUID() : null);

    await db.insert(interviewKitStages).values({
      tenantId,
      kitId,
      name,
      kind: isInterviewKitStageKind(stage.kind) ? stage.kind : 'screen',
      position,
      durationMin: stage.durationMin ?? null,
      scorecardId,
      interviewerRefs: (stage.interviewerRefs ?? []).filter((ref) => typeof ref === 'string').slice(0, 20),
      guidance: stage.guidance?.slice(0, 4_000) ?? null,
    });

    if (scorecardId && attributes.length) {
      await db.insert(scorecardAttributes).values(attributes.map((attribute, index) => ({
        tenantId,
        scorecardId,
        key: attribute.key,
        label: attribute.label,
        weight: String(Math.max(0, Math.min(99, attribute.weight ?? 1))),
        scaleMin: Math.round(attribute.scaleMin ?? 1),
        scaleMax: Math.round(attribute.scaleMax ?? 5),
        position: index,
      })));
    }
  }
}

/** Exactly one default per tenant. Clearing the others is part of SETTING one, not a
 *  second call a caller has to remember. */
async function clearOtherDefaults(db: Db, tenantId: number, keepKitId: number): Promise<void> {
  await db
    .update(interviewKits)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(scopedToTenant(interviewKits, tenantId, eq(interviewKits.isDefault, true)));
  await db
    .update(interviewKits)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(scopedToTenant(interviewKits, tenantId, eq(interviewKits.id, keepKitId)));
}

export async function createInterviewKit(
  db: Db,
  env: Env,
  tenantId: number,
  input: InterviewKitInput & { createdBy?: string | null },
): Promise<InterviewKit> {
  const name = input.name.trim().slice(0, 200);
  if (!name) throw new AtsError('A kit needs a name — it is how a recruiter picks it.', 400);

  // `uq_interview_kits_name` is unique per tenant. A duplicate is a real answer — "you
  // already have one of these" — so the constraint violation is translated rather than
  // allowed to surface as a 500, and anything that is NOT that violation is rethrown
  // untouched.
  const [row] = await db
    .insert(interviewKits)
    .values({
      tenantId,
      name,
      roleFamily: input.roleFamily?.slice(0, 96) ?? null,
      description: input.description?.slice(0, 4_000) ?? null,
      isDefault: false,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: interviewKits.id })
    .catch((error: unknown) => {
      if (isUniqueViolation(error)) throw new AtsError(`A kit called "${name}" already exists in this workspace.`, 409);
      throw error;
    });
  if (!row) throw new AtsError('The kit could not be created.', 500);

  await replaceStages(db, tenantId, row.id, input.stages ?? []);
  if (input.isDefault) await clearOtherDefaults(db, tenantId, row.id);
  await invalidateInterviewKits(env, tenantId);

  const kit = (await readInterviewKits(db, tenantId)).find((entry) => entry.id === row.id);
  if (!kit) throw new AtsError('The kit could not be read back after creation.', 500);
  return kit;
}

export async function updateInterviewKit(
  db: Db,
  env: Env,
  tenantId: number,
  kitId: number,
  input: Partial<InterviewKitInput>,
): Promise<InterviewKit> {
  const [existing] = await db
    .select({ id: interviewKits.id })
    .from(interviewKits)
    .where(scopedToTenant(interviewKits, tenantId, eq(interviewKits.id, kitId)))
    .limit(1);
  if (!existing) throw new AtsError('No such interview kit in this workspace.', 404);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 200);
    if (!name) throw new AtsError('A kit needs a name.', 400);
    patch.name = name;
  }
  if (input.roleFamily !== undefined) patch.roleFamily = input.roleFamily?.slice(0, 96) ?? null;
  if (input.description !== undefined) patch.description = input.description?.slice(0, 4_000) ?? null;

  await db
    .update(interviewKits)
    .set(patch)
    .where(scopedToTenant(interviewKits, tenantId, eq(interviewKits.id, kitId)));

  if (input.stages !== undefined) await replaceStages(db, tenantId, kitId, input.stages);
  if (input.isDefault) await clearOtherDefaults(db, tenantId, kitId);
  await invalidateInterviewKits(env, tenantId);

  const kit = (await readInterviewKits(db, tenantId)).find((entry) => entry.id === kitId);
  if (!kit) throw new AtsError('The kit could not be read back after the update.', 500);
  return kit;
}

/**
 * Delete a kit, and the scorecards its stages owned.
 *
 * The stages cascade from the kit; the attributes do NOT (a scorecard id has no foreign
 * key, deliberately), so they are removed here. Leaving them would accumulate dimensions
 * belonging to a scorecard nothing points at — invisible rows that still turn up in the
 * cross-scorecard attribute reports the table exists for.
 */
export async function deleteInterviewKit(db: Db, env: Env, tenantId: number, kitId: number): Promise<void> {
  const stages = await db
    .select({ scorecardId: interviewKitStages.scorecardId })
    .from(interviewKitStages)
    .where(scopedToTenant(interviewKitStages, tenantId, eq(interviewKitStages.kitId, kitId)));
  const scorecardIds = stages.flatMap((stage) => (stage.scorecardId ? [stage.scorecardId] : []));
  if (scorecardIds.length) {
    await db
      .delete(scorecardAttributes)
      .where(scopedToTenant(scorecardAttributes, tenantId, inArray(scorecardAttributes.scorecardId, scorecardIds)));
  }
  await db
    .delete(interviewKits)
    .where(scopedToTenant(interviewKits, tenantId, eq(interviewKits.id, kitId)));
  await invalidateInterviewKits(env, tenantId);
}

/**
 * The kit a scheduler should use — the tenant's default, seeded on first ask.
 *
 * Seeding here rather than at signup is deliberate: a tenant that never hires never gets
 * a kit, and the row exists the moment somebody actually opens the hiring surface.
 */
export async function ensureDefaultKit(
  db: Db,
  env: Env,
  tenantId: number,
  createdBy?: string | null,
): Promise<InterviewKit> {
  const kits = await listInterviewKits(env, db, tenantId);
  const existing = kits.find((kit) => kit.isDefault) ?? kits[0];
  if (existing) return existing;

  return createInterviewKit(db, env, tenantId, {
    name: DEFAULT_INTERVIEW_KIT_NAME,
    description: 'The house loop. Every stage, its length and what it scores on are editable — this is a starting point, not a policy.',
    isDefault: true,
    createdBy: createdBy ?? null,
    stages: DEFAULT_INTERVIEW_KIT_STAGES.map((stage) => ({
      name: stage.name,
      kind: stage.kind,
      durationMin: stage.durationMin,
      guidance: stage.guidance,
      scorecard: stage.scorecard.map((attribute) => ({ key: attribute.key, label: attribute.label, weight: attribute.weight })),
    })),
  });
}
