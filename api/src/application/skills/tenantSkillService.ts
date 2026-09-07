/**
 * Tenant skills — the ONE governed path in and out of a workspace's own skills.
 *
 * The invariant this module exists to hold: an agent may PROPOSE a procedure, and
 * only a human may make one binding. Everything that writes here goes through
 * `proposeSkill` (agent side, always lands as a draft) or `reviewSkill` (human
 * side, the only way `status` becomes `approved`), so "an agent cannot change what
 * other agents are told to do" is a property of this file rather than a rule each
 * caller has to remember.
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

export type TenantSkillStatus = 'draft' | 'approved' | 'rejected';

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

/** Max stored body — a skill is a procedure, not a transcript. */
const BODY_MAX = 8_000;
const approvedKey = (tenantId: number, projectId: number | null): string =>
  `tenant-skills:approved:${tenantId}:${projectId ?? 'all'}`;

const slugify = (raw: string): string =>
  raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 255);

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
  };
}

/** Drop every cached read a write to this workspace could have changed. */
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
  const slug = slugify(input.slug);
  const name = input.name.trim().slice(0, 255);
  const description = input.description.trim().slice(0, 1_000);
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
      const scope = projectId == null
        ? isNull(tenantSkills.projectId)
        : or(isNull(tenantSkills.projectId), eq(tenantSkills.projectId, projectId));
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
  const [row] = await db
    .delete(tenantSkills)
    .where(scopedToTenant(tenantSkills, tenantId, eq(tenantSkills.id, skillId)))
    .returning({ projectId: tenantSkills.projectId });
  if (!row) return false;
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

/** Approved skills rendered as the prompt block an agent reads. '' when none. */
export function renderSkillBlock(skills: readonly TenantSkill[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map((s) => `### ${s.name} (${s.slug})\n${s.description}\n\n${s.body}`);
  return ['## Workspace Skills (approved procedures)', ...lines].join('\n\n');
}
