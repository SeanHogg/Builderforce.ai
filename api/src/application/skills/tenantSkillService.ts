/**
 * Tenant skills — the ONE governed path in and out of a workspace's own skills.
 *
 * The invariant this module exists to hold: an agent may PROPOSE a procedure, and
 * only a human may make one binding. Everything that writes here goes through
 * `proposeSkill` (agent side, always lands as a draft), `reviewSkill` (human side,
 * the reviewer's decision) or `saveHumanSkill` (human side, a person bringing in a
 * skill folder they wrote — they ARE the reviewer), so "an agent cannot change what
 * other agents are told to do" is a property of this file rather than a rule each
 * caller has to remember.
 *
 * A workspace skill is an Agent Skills folder (agentskills.io): `slug` is the spec
 * `name` (kebab-case, ≤ 64), `description` is the spec `description` (≤ 1024), `body`
 * is the SKILL.md instructions, `manifest` the optional frontmatter, and bundled files
 * live in `skill_files` (see `skillFileStore`).
 *
 * Reads are cached read-through and invalidated on write, because the approved set
 * is injected into every agent prompt on the project and changes rarely.
 */

import { desc, eq, isNull, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenantSkills } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import { SKILL_DESCRIPTION_MAX, toSkillName, type SkillPackage } from '@builderforce/agent-skills';
import {
  listWorkspaceSkillFileEntries,
  manifestRecordOf,
  deleteSkillAssets,
  saveSkillFolder,
  skillAssetBucket,
  skillAssetKeys,
  SkillAssetStorageUnavailable,
  type SkillFileEntry,
  type SkillManifestRecord,
} from './skillFileStore';

export type TenantSkillStatus = 'draft' | 'approved' | 'rejected';

/** `replace` (default) ships the next version of a name; `create` refuses a name in use. */
export type SkillSaveMode = 'create' | 'replace';

export interface TenantSkill {
  id: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  status: TenantSkillStatus;
  projectId: number | null;
  authorKind: string;
  authorLabel: string | null;
  evidence: string | null;
  originExecutionId: number | null;
  originTaskId: number | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  updatedAt: string;
  /** Optional spec frontmatter (license, compatibility, metadata, allowed-tools). */
  manifest: SkillManifestRecord | null;
}

/** A workspace skill as the review queue shows it: the row plus its folder listing. */
export interface TenantSkillWithFiles extends TenantSkill {
  files: SkillFileEntry[];
}

export interface ProposeSkillInput {
  slug: string;
  name: string;
  description: string;
  body: string;
  evidence?: string;
  projectId?: number | null;
  originExecutionId?: number | null;
  originTaskId?: number | null;
  /** Which agent proposed it, for the reviewer. */
  authorLabel?: string | null;
}

/** Max body an AGENT may propose — a distilled procedure, not a transcript. */
const BODY_MAX = 8_000;
/**
 * Max body a PERSON may bring in. The spec recommends SKILL.md stay under ~500 lines
 * and move detail into `references/`; this is that recommendation with headroom, not a
 * reason to refuse a real skill written elsewhere.
 */
const HUMAN_BODY_MAX = 64_000;
const approvedKey = (tenantId: number, projectId: number | null): string =>
  `tenant-skills:approved:${tenantId}:${projectId ?? 'all'}`;

function toSkill(row: typeof tenantSkills.$inferSelect): TenantSkill {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    body: row.body,
    status: row.status as TenantSkillStatus,
    projectId: row.projectId,
    authorKind: row.authorKind,
    authorLabel: row.authorLabel,
    evidence: row.evidence,
    originExecutionId: row.originExecutionId,
    originTaskId: row.originTaskId,
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : null,
    reviewNote: row.reviewNote,
    updatedAt: new Date(row.updatedAt).toISOString(),
    manifest: (row.manifest as SkillManifestRecord | null | undefined) ?? null,
  };
}

/** Drop every cached read a write to this workspace could have changed. */
/** Which skills a project scope sees: workspace-wide plus its own; `undefined` = no filter. */
function projectScope(projectId: number | null | undefined) {
  if (projectId === undefined) return undefined;
  return projectId == null
    ? isNull(tenantSkills.projectId)
    : or(isNull(tenantSkills.projectId), eq(tenantSkills.projectId, projectId));
}

async function invalidateSkills(env: Env | undefined, tenantId: number, projectId: number | null): Promise<void> {
  await Promise.all([
    invalidateCached(env, approvedKey(tenantId, null)),
    ...(projectId != null ? [invalidateCached(env, approvedKey(tenantId, projectId))] : []),
  ]);
}

/**
 * Draft a skill from a run. ALWAYS lands as a draft: re-proposing an existing slug
 * revises that draft, and a slug that already names an APPROVED skill is refused
 * rather than silently reopened — an approved procedure changes through review only.
 */
export async function proposeSkill(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  input: ProposeSkillInput,
): Promise<{ ok: boolean; slug?: string; outcome?: 'created' | 'revised'; error?: string }> {
  // The slug IS the spec `name`, so it is held to the spec here — a draft that cannot be
  // exported as a valid skill folder would be a draft no other agent tool could load.
  const slug = toSkillName(input.slug);
  const name = input.name.trim().slice(0, 255);
  const description = input.description.trim().slice(0, SKILL_DESCRIPTION_MAX);
  const body = input.body.trim().slice(0, BODY_MAX);
  if (!slug || !name || !description || !body) {
    return { ok: false, error: 'slug, name, description and body are all required' };
  }

  const [existing] = await db
    .select({ id: tenantSkills.id, status: tenantSkills.status })
    .from(tenantSkills)
    .where(scopedToTenant(tenantSkills, tenantId, eq(tenantSkills.slug, slug)))
    .limit(1);

  if (existing?.status === 'approved') {
    return { ok: false, error: `“${slug}” is already an approved skill — propose a different slug or ask a reviewer to revise it` };
  }

  const now = new Date();
  const values = {
    tenantId,
    projectId: input.projectId ?? null,
    slug,
    name,
    description,
    body,
    status: 'draft' as const,
    authorKind: 'agent' as const,
    authorLabel: input.authorLabel ?? null,
    evidence: input.evidence?.trim().slice(0, 2_000) ?? null,
    originExecutionId: input.originExecutionId ?? null,
    originTaskId: input.originTaskId ?? null,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(tenantSkills)
      .set({ ...values, reviewedBy: null, reviewedAt: null, reviewNote: null })
      .where(scopedToTenant(tenantSkills, tenantId, eq(tenantSkills.id, existing.id)));
    await invalidateSkills(env, tenantId, input.projectId ?? null);
    return { ok: true, slug, outcome: 'revised' };
  }

  await db.insert(tenantSkills).values(values);
  await invalidateSkills(env, tenantId, input.projectId ?? null);
  return { ok: true, slug, outcome: 'created' };
}

/** Whether a run already proposed (or revised) a skill — the agent's own `skill_propose`. */
export async function skillProposedByExecution(db: Db, tenantId: number, executionId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: tenantSkills.id })
    .from(tenantSkills)
    .where(scopedToTenant(tenantSkills, tenantId, eq(tenantSkills.originExecutionId, executionId)))
    .limit(1);
  return !!row;
}

/** Every skill in the workspace, newest first — the reviewer's queue. */
export async function listSkills(db: Db, tenantId: number, status?: TenantSkillStatus): Promise<TenantSkill[]> {
  const rows = await db
    .select()
    .from(tenantSkills)
    .where(scopedToTenant(tenantSkills, tenantId, status ? eq(tenantSkills.status, status) : undefined))
    .orderBy(desc(tenantSkills.updatedAt))
    .limit(200);
  return rows.map(toSkill);
}

/** The review queue with each skill's folder listing — two queries, never one per row. */
export async function listSkillsWithFiles(db: Db, tenantId: number, status?: TenantSkillStatus): Promise<TenantSkillWithFiles[]> {
  const skills = await listSkills(db, tenantId, status);
  const files = await listWorkspaceSkillFileEntries(db, skills.map((s) => s.id));
  return skills.map((s) => ({ ...s, files: files.get(s.id) ?? [] }));
}

/** One workspace skill by id (any status) — the export reads the row it is handed. */
export async function getSkill(db: Db, tenantId: number, skillId: string): Promise<TenantSkill | null> {
  const [row] = await db
    .select()
    .from(tenantSkills)
    .where(scopedToTenant(tenantSkills, tenantId, eq(tenantSkills.id, skillId)))
    .limit(1);
  return row ? toSkill(row) : null;
}

/**
 * One APPROVED workspace skill by its spec name — what an agent may load and follow.
 * Scoped like {@link approvedSkillsForRun}: a project sees workspace-wide skills and its
 * own, `null` sees workspace-wide only, and `undefined` (no project context) sees all.
 */
export async function getApprovedSkillBySlug(
  db: Db,
  tenantId: number,
  slug: string,
  projectId?: number | null,
): Promise<TenantSkill | null> {
  const [row] = await db
    .select()
    .from(tenantSkills)
    .where(scopedToTenant(
      tenantSkills,
      tenantId,
      eq(tenantSkills.slug, slug),
      eq(tenantSkills.status, 'approved'),
      projectScope(projectId),
    ))
    .limit(1);
  return row ? toSkill(row) : null;
}

/**
 * The second human half: a person brings in a skill folder they wrote (imported from
 * disk, a .zip, another agent tool). They are signing it off by importing it, so it
 * lands APPROVED with them recorded as the reviewer — exactly the state a review would
 * have produced, with the same audit columns filled. Re-importing a name replaces that
 * skill and its whole folder, which is how a person ships the next version; `mode:
 * 'create'` (writing a new skill) refuses a name already in use instead.
 */
export async function saveHumanSkill(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  input: { pkg: SkillPackage; projectId?: number | null; userId: string; note?: string; mode?: SkillSaveMode },
): Promise<{ ok: boolean; skill?: TenantSkill; outcome?: 'created' | 'replaced'; error?: string; conflict?: boolean }> {
  const { manifest, body, files } = input.pkg;
  if (body.length > HUMAN_BODY_MAX) {
    return { ok: false, error: `SKILL.md instructions are ${body.length} characters; the limit is ${HUMAN_BODY_MAX}. Move detail into references/.` };
  }
  const now = new Date();
  // A skill's display title is the spec's `metadata.title` when the author gave one,
  // else its name — the spec has no title field, and inventing one would not round-trip.
  const title = (manifest.metadata?.title ?? manifest.name).slice(0, 255);
  const values = {
    tenantId,
    projectId: input.projectId ?? null,
    slug: manifest.name,
    name: title,
    description: manifest.description,
    body,
    manifest: manifestRecordOf(manifest),
    status: 'approved' as const,
    authorKind: 'human' as const,
    authorLabel: null,
    evidence: null,
    originExecutionId: null,
    originTaskId: null,
    reviewedBy: input.userId,
    reviewedAt: now,
    reviewNote: input.note?.trim().slice(0, 1_000) || 'Imported as an Agent Skills folder.',
    updatedAt: now,
  };

  const [existing] = await db
    .select({ id: tenantSkills.id, projectId: tenantSkills.projectId })
    .from(tenantSkills)
    .where(scopedToTenant(tenantSkills, tenantId, eq(tenantSkills.slug, manifest.name)))
    .limit(1);
  if (existing && input.mode === 'create') {
    return { ok: false, conflict: true, error: `A skill named "${manifest.name}" already exists in this workspace.` };
  }

  // The row and its folder commit together (`saveSkillFolder`): a failed file write must
  // not leave the new instructions beside files that are gone. A new skill's id is minted
  // here so its binary assets can be keyed under it before the row exists.
  const id = existing?.id ?? crypto.randomUUID();
  let row: typeof tenantSkills.$inferSelect | undefined;
  try {
    row = await saveSkillFolder(db, skillAssetBucket(env), { owner: { kind: 'workspace', id }, scope: String(tenantId) }, files, async (tx) => {
      const [saved] = existing
        ? await tx.update(tenantSkills).set(values).where(scopedToTenant(tenantSkills, tenantId, eq(tenantSkills.id, id))).returning()
        : await tx.insert(tenantSkills).values({ ...values, id }).returning();
      return saved;
    });
  } catch (error) {
    if (error instanceof SkillAssetStorageUnavailable) return { ok: false, error: error.message };
    throw error;
  }
  if (!row) return { ok: false, error: 'The skill could not be saved' };
  // A re-import may move the skill between projects; both scopes' caches held it.
  await invalidateSkills(env, tenantId, row.projectId);
  if (existing && existing.projectId !== row.projectId) await invalidateSkills(env, tenantId, existing.projectId);
  return { ok: true, skill: toSkill(row), outcome: existing ? 'replaced' : 'created' };
}

/**
 * The approved skills that apply to a run: workspace-wide ones plus this project's.
 * Cached — it is read on every agent turn and changes only on review.
 */
export async function approvedSkillsForRun(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  projectId: number | null,
): Promise<TenantSkill[]> {
  return getOrSetCached(
    env,
    approvedKey(tenantId, projectId),
    async () => {
      const scope = projectScope(projectId);
      const rows = await db
        .select()
        .from(tenantSkills)
        .where(scopedToTenant(tenantSkills, tenantId, eq(tenantSkills.status, 'approved'), scope))
        .orderBy(desc(tenantSkills.updatedAt))
        .limit(50);
      return rows.map(toSkill);
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

/**
 * The human half. This is the ONLY writer that can set `approved`, which is what
 * makes "an agent-authored skill is inert until a person says otherwise" true.
 */
export async function reviewSkill(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  skillId: string,
  decision: 'approved' | 'rejected',
  reviewer: { userId: string; note?: string },
): Promise<{ ok: boolean; skill?: TenantSkill; error?: string }> {
  const [row] = await db
    .update(tenantSkills)
    .set({
      status: decision,
      reviewedBy: reviewer.userId,
      reviewedAt: new Date(),
      reviewNote: reviewer.note?.trim().slice(0, 1_000) ?? null,
      updatedAt: new Date(),
    })
    .where(scopedToTenant(tenantSkills, tenantId, eq(tenantSkills.id, skillId)))
    .returning();
  if (!row) return { ok: false, error: 'Skill not found' };
  await invalidateSkills(env, tenantId, row.projectId);
  return { ok: true, skill: toSkill(row) };
}

/** Delete a skill outright. A rejected draft is kept by default; this is the purge. */
export async function deleteSkill(env: Env | undefined, db: Db, tenantId: number, skillId: string): Promise<boolean> {
  // The file rows cascade with the skill; their R2 objects do not, so read the keys first.
  const assetKeys = await skillAssetKeys(db, { kind: 'workspace', id: skillId });
  const [row] = await db
    .delete(tenantSkills)
    .where(scopedToTenant(tenantSkills, tenantId, eq(tenantSkills.id, skillId)))
    .returning({ projectId: tenantSkills.projectId });
  if (!row) return false;
  await deleteSkillAssets(skillAssetBucket(env), assetKeys, 'deleteSkill');
  await invalidateSkills(env, tenantId, row.projectId);
  return true;
}

/** The `skill.author` capability for a run, with the run's identity closed over. */
export function buildSkillAuthoringCapability(args: {
  env: Env;
  db: Db;
  tenantId: number;
  projectId?: number | null;
  executionId?: number | null;
  taskId?: number | null;
  agentLabel?: string;
}) {
  const { env, db, tenantId } = args;
  return {
    async propose(input: { slug: string; name: string; description: string; body: string; evidence?: string }) {
      return proposeSkill(env, db, tenantId, {
        ...input,
        projectId: args.projectId ?? null,
        originExecutionId: args.executionId ?? null,
        originTaskId: args.taskId ?? null,
        authorLabel: args.agentLabel ?? null,
      });
    },
    async list() {
      const skills = await listSkills(db, tenantId);
      return {
        ok: true,
        skills: skills.map((s) => ({ slug: s.slug, name: s.name, description: s.description, status: s.status })),
      };
    },
  };
}
