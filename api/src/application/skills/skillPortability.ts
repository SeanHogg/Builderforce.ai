/**
 * Skill PORTABILITY — moving an Agent Skills folder in and out of the platform.
 *
 * In: a folder a person wrote anywhere (another agent tool's skills directory, a repo,
 * a .zip) becomes a workspace skill, or a marketplace listing, with every file intact.
 * Out: any skill the workspace can see leaves as the same spec folder, loadable by any
 * conforming agent. Both directions go through `@builderforce/agent-skills`, so what the
 * platform accepts and what it emits are held to one definition of a valid skill.
 */

import { eq, sql } from 'drizzle-orm';
import { readSkillPackage, type SkillFile, type SkillIssue, type SkillPackage } from '@builderforce/agent-skills';
import type { Db } from '../../infrastructure/database/connection';
import { isUniqueViolation } from '../../infrastructure/database/uniqueViolation';
import type { Env } from '../../env';
import { marketplaceSkills } from '../../infrastructure/database/schema';
import { getSkill, saveHumanSkill, type SkillSaveMode, type TenantSkill } from './tenantSkillService';
import { loadSkillFiles, manifestRecordOf, saveSkillFolder, skillAssetBucket, toSkillFolder } from './skillFileStore';

export type ImportSkillResult =
  | { ok: true; skill: TenantSkill; outcome: 'created' | 'replaced'; issues: SkillIssue[] }
  | { ok: false; issues: SkillIssue[]; conflict?: boolean };

const saveFailure = (message: string): SkillIssue => ({ severity: 'error', field: 'SKILL.md', code: 'save_failed', message });
const nameTaken = (message: string): SkillIssue => ({ severity: 'error', field: 'name', code: 'name_taken', message });

/** Import a skill folder into the workspace, signed off by the person importing it. */
export async function importWorkspaceSkill(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  input: { files: readonly SkillFile[]; projectId?: number | null; userId: string; mode?: SkillSaveMode },
): Promise<ImportSkillResult> {
  const read = readSkillPackage(input.files);
  if (!read.package) return { ok: false, issues: read.issues };
  const storable = refuseUnstorableAssets(env, read.package);
  if (storable) return { ok: false, issues: [...read.issues, storable] };
  const saved = await saveHumanSkill(env, db, tenantId, { pkg: read.package, projectId: input.projectId ?? null, userId: input.userId, mode: input.mode });
  if (saved.conflict) return { ok: false, conflict: true, issues: [...read.issues, nameTaken(saved.error ?? 'That name is already in use')] };
  if (!saved.ok || !saved.skill) return { ok: false, issues: [...read.issues, saveFailure(saved.error ?? 'The skill could not be saved')] };
  return { ok: true, skill: saved.skill, outcome: saved.outcome ?? 'created', issues: read.issues };
}

/** A workspace skill (any status — a reviewer may export a draft) as a spec folder. */
export async function exportWorkspaceSkill(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  skillId: string,
): Promise<{ name: string; files: SkillFile[] } | null> {
  const skill = await getSkill(db, tenantId, skillId);
  if (!skill) return null;
  const files = await loadSkillFiles(db, skillAssetBucket(env), { kind: 'workspace', id: skill.id });
  return toSkillFolder({ name: skill.slug, title: skill.name, description: skill.description, body: skill.body, manifest: skill.manifest, files });
}

/**
 * Read an uploaded folder for a marketplace listing. The listing's slug, name,
 * description and readme are DERIVED from the SKILL.md, so a published skill can never
 * say one thing on its card and another in the folder an installer receives.
 */
export function readMarketplaceSkillFolder(env: Env | undefined, files: readonly SkillFile[]): { pkg: SkillPackage | null; issues: SkillIssue[] } {
  const read = readSkillPackage(files);
  const storable = refuseUnstorableAssets(env, read.package);
  if (storable) return { pkg: null, issues: [...read.issues, storable] };
  return { pkg: read.package, issues: read.issues };
}

/**
 * The issue for a folder whose binary assets have nowhere to go (no UPLOADS bucket
 * bound), or null. Checked BEFORE anything is written, so the person sees why instead of
 * a half-saved skill.
 */
function refuseUnstorableAssets(env: Env | undefined, pkg: SkillPackage | null): SkillIssue | null {
  if (!pkg || skillAssetBucket(env) || !pkg.files.some((f) => f.encoding === 'base64')) return null;
  return {
    severity: 'error',
    field: 'assets/',
    code: 'binary_storage_unavailable',
    message: 'This skill bundles binary assets, and binary storage is not available on this server. Remove them or try again later.',
  };
}

/**
 * Persist a marketplace skill's folder: the SKILL.md's description, instructions and
 * manifest on the row, its files beside it — so the listing and the folder agree.
 */
export async function saveMarketplaceSkillFolder(env: Env | undefined, db: Db, skillId: number, pkg: SkillPackage): Promise<void> {
  // One unit: a listing must never describe a folder its files no longer match.
  await saveSkillFolder(db, skillAssetBucket(env), { owner: { kind: 'marketplace', id: skillId }, scope: 'market' }, pkg.files, async (tx) => {
    await tx
      .update(marketplaceSkills)
      .set({ description: pkg.manifest.description, manifest: manifestRecordOf(pkg.manifest), readme: pkg.body, updatedAt: new Date() })
      .where(eq(marketplaceSkills.id, skillId));
  });
}

export type NewMarketplaceListing = Omit<typeof marketplaceSkills.$inferInsert, 'id'>;

/**
 * Create a marketplace listing — with its folder, when one was sent, in ONE unit: the
 * listing row is written inside `saveSkillFolder`'s transaction (its id minted first, as
 * `saveHumanSkill` does), so a failed file write never leaves a listing with no folder.
 * `slug_taken` is decided by the slug, never by matching some other unique violation.
 */
export async function createMarketplaceSkillListing(
  env: Env | undefined,
  db: Db,
  listing: NewMarketplaceListing,
  folder: SkillPackage | null,
): Promise<{ ok: true; skill: typeof marketplaceSkills.$inferSelect } | { ok: false; reason: 'slug_taken' }> {
  const [taken] = await db.select({ id: marketplaceSkills.id }).from(marketplaceSkills).where(eq(marketplaceSkills.slug, listing.slug)).limit(1);
  if (taken) return { ok: false, reason: 'slug_taken' };
  try {
    if (!folder) {
      const [skill] = await db.insert(marketplaceSkills).values(listing).returning();
      return { ok: true, skill: skill! };
    }
    const minted = await db.execute(sql`SELECT nextval(pg_get_serial_sequence('marketplace_skills', 'id'))::int AS id`);
    const id = Number((minted.rows[0] as { id: number | string }).id);
    const skill = await saveSkillFolder(db, skillAssetBucket(env), { owner: { kind: 'marketplace', id }, scope: 'market' }, folder.files, async (tx) => {
      const [row] = await tx
        .insert(marketplaceSkills)
        .values({ ...listing, id, description: folder.manifest.description, manifest: manifestRecordOf(folder.manifest), readme: folder.body })
        .returning();
      return row!;
    });
    return { ok: true, skill };
  } catch (error) {
    // Lost a race for the same slug between the check and the insert.
    if (isUniqueViolation(error, 'slug')) return { ok: false, reason: 'slug_taken' };
    throw error;
  }
}

/**
 * A PUBLISHED, FREE marketplace skill as a spec folder — public, like its listing. A
 * paid listing's folder is what checkout sells, so it never leaves here; a buyer's
 * workspace gets it through its assignment (`exportLibrarySkill`).
 */
export async function exportPublishedMarketplaceSkill(env: Env | undefined, db: Db, slug: string): Promise<{ name: string; files: SkillFile[] } | null> {
  const [row] = await db
    .select({
      id: marketplaceSkills.id,
      slug: marketplaceSkills.slug,
      name: marketplaceSkills.name,
      description: marketplaceSkills.description,
      readme: marketplaceSkills.readme,
      published: marketplaceSkills.published,
      priceCents: marketplaceSkills.priceCents,
      manifest: marketplaceSkills.manifest,
    })
    .from(marketplaceSkills)
    .where(eq(marketplaceSkills.slug, slug))
    .limit(1);
  if (!row || !row.published || (row.priceCents ?? 0) > 0) return null;
  const files = await loadSkillFiles(db, skillAssetBucket(env), { kind: 'marketplace', id: row.id });
  return toSkillFolder({ name: row.slug, title: row.name, description: row.description ?? '', body: row.readme ?? '', manifest: row.manifest, files });
}
