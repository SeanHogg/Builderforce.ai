/**
 * The skill LIBRARY — what skills an agent on this workspace can see, and how it loads
 * one. The ONE engine behind every surface: the cloud run's catalog block, the
 * `skills.read` platform tool (which the gateway catalog carries to the Brain on the
 * web, in VS Code and in Rovr, to the canvas and the Studio, and to any external MCP
 * client), and the package endpoint the on-prem runtime syncs assigned skills from.
 *
 * It implements the Agent Skills spec's progressive disclosure:
 *   1. CATALOG — name + description per skill ({@link skillLibraryCatalog}), always shown;
 *   2. INSTRUCTIONS — the SKILL.md body, loaded when a task matches ({@link readLibrarySkill});
 *   3. RESOURCES — a bundled file, loaded only when the instructions call for it.
 *
 * Three sources, in precedence order (a name resolves to the first that has it):
 *   • workspace — the workspace's own APPROVED skills (a draft is never visible here);
 *   • marketplace — published skills, and any skill this workspace was assigned;
 *   • builtin — the instructions the platform ships for its runtime skills.
 * The catalog lists the workspace's approved skills and its tenant-wide assignments;
 * run-, project- and agent-scoped assignments are inlined into that run's prompt as
 * mandatory capabilities (`artifact/capabilityContext`), which is a stronger contract
 * than "listed".
 */

import { and, eq } from 'drizzle-orm';
import {
  formatSkillCatalog,
  SKILL_FILE,
  TOOL_HOST_INSTRUCTIONS,
  normalizeSkillPath,
  type SkillFile,
} from '@builderforce/agent-skills';
import { LEXICAL_WEIGHTS, rankLexically } from '@builderforce/agent-tools';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { skillAssignmentCacheKey } from './skillAssignmentCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { hasPaidSkillEntitlement, withholdUnpaidSkills } from '../marketplace/skillEntitlement';
import { artifactAssignments, marketplaceSkills } from '../../infrastructure/database/schema';
import { loadSkillBody } from '../artifact/capabilityContext';
import { getBuiltinSkillBody } from '../artifact/builtinSkills';
import { approvedSkillsForRun, getApprovedSkillBySlug, type TenantSkill } from './tenantSkillService';
import {
  listSkillFileEntries,
  loadSkillFiles,
  manifestFromRecord,
  readSkillFile,
  skillAssetBucket,
  toSkillFolder,
  type SkillFileEntry,
  type SkillOwner,
} from './skillFileStore';

export type SkillSource = 'workspace' | 'marketplace' | 'builtin';

/** One catalog entry — level one of progressive disclosure. */
export interface LibrarySkillSummary {
  name: string;
  description: string;
  source: SkillSource;
}

/** A loaded skill — level two: its instructions and what else its folder holds. */
export interface LoadedLibrarySkill {
  ok: true;
  name: string;
  title: string;
  description: string;
  source: SkillSource;
  instructions: string;
  files: SkillFileEntry[];
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
}

/** A loaded bundled file — level three. */
export interface LoadedSkillFile {
  ok: true;
  name: string;
  path: string;
  content: string;
}

export interface SkillLibraryMiss {
  ok: false;
  error: string;
  /** The names that DO exist, so the model's next call is right instead of another guess. */
  available: string[];
}

/** Catalog cap: a library this size is still cheap, and past it the list is noise. */
const CATALOG_LIMIT = 60;

/**
 * Slugs assigned tenant-wide. Cached read-through — the gateway lists tools on every
 * surface mount — under the tenant's assignment version, which every assignment
 * writer bumps (`skillAssignmentCache`).
 */
async function tenantAssignedSkillSlugs(env: Env | undefined, db: Db, tenantId: number): Promise<string[]> {
  return getOrSetCached(env, await skillAssignmentCacheKey(env, tenantId, 'tenant'), async () => {
    const rows = await db
      .select({ slug: artifactAssignments.artifactSlug })
      .from(artifactAssignments)
      .where(and(
        eq(artifactAssignments.tenantId, tenantId),
        eq(artifactAssignments.artifactType, 'skill'),
        eq(artifactAssignments.scope, 'tenant'),
      ))
      .limit(CATALOG_LIMIT);
    return rows.map((r) => r.slug);
  });
}

/** The workspace's catalog: approved skills first, then tenant-wide assignments. */
export async function skillLibraryCatalog(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number | null = null,
): Promise<LibrarySkillSummary[]> {
  const [approved, assignedSlugs] = await Promise.all([
    approvedSkillsForRun(env, db, tenantId, projectId),
    tenantAssignedSkillSlugs(env, db, tenantId),
  ]);
  const seen = new Set<string>();
  const out: LibrarySkillSummary[] = [];
  for (const s of approved) {
    if (seen.has(s.slug)) continue;
    seen.add(s.slug);
    out.push({ name: s.slug, description: s.description, source: 'workspace' });
  }
  // A paid skill is listed only with its entitlement — the catalog advertises what
  // `skills.read` would actually serve.
  const listable = await withholdUnpaidSkills(db, tenantId, assignedSlugs.filter((slug) => !seen.has(slug)), 'skillLibraryCatalog');
  const assigned = await Promise.all(
    listable.map(async (slug) => ({ slug, body: await loadSkillBody(env, db, slug) })),
  );
  for (const { slug, body } of assigned) {
    if (!body || seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      name: slug,
      description: body.description?.trim() || body.name,
      // `loadSkillBody` falls back to the builtin registry when no marketplace row exists.
      source: body.readme != null && body.readme === getBuiltinSkillBody(slug)?.readme ? 'builtin' : 'marketplace',
    });
  }
  return out.slice(0, CATALOG_LIMIT);
}

/** The catalog as a prompt block (tool host). '' when the library is empty. */
export function renderSkillCatalogBlock(skills: readonly Pick<LibrarySkillSummary, 'name' | 'description'>[]): string {
  return formatSkillCatalog(skills.map((s) => ({ name: s.name, description: s.description })), TOOL_HOST_INSTRUCTIONS);
}

/** The approved workspace skills as catalog entries — what a cloud run is shown. */
export function workspaceSkillSummaries(skills: readonly TenantSkill[]): LibrarySkillSummary[] {
  return skills.map((s) => ({ name: s.slug, description: s.description, source: 'workspace' as const }));
}

/** How many approved skills a run is shown under cost lever E1. */
export const RANKED_SKILL_LIMIT = 5;

/**
 * The approved skills most relevant to a task (cost lever E1): ranked by lexical overlap
 * of each skill's name/slug (strong), description — its trigger — and body (weak) with
 * the task text, through the ONE shared scorer. Only skills that match at all are kept,
 * best first, at most `limit`.
 */
export function rankSkillsForTask(skills: readonly TenantSkill[], taskText: string, limit = RANKED_SKILL_LIMIT): TenantSkill[] {
  return rankLexically(skills, taskText, (s) => [
    { text: `${s.name} ${s.slug.replace(/[-_]/g, ' ')}`, weight: LEXICAL_WEIGHTS.name },
    { text: s.description, weight: LEXICAL_WEIGHTS.description * 3 },
    { text: s.body, weight: LEXICAL_WEIGHTS.body },
  ], limit);
}

// ── Resolution ────────────────────────────────────────────────────────────────

interface ResolvedSkill {
  name: string;
  title: string;
  description: string;
  source: SkillSource;
  instructions: string;
  owner: SkillOwner | null;
  manifest: unknown;
}

/**
 * Whether a marketplace skill is visible to this workspace: published, or assigned to it
 * — and, when it is PAID, only with an entitlement (`hasPaidSkillEntitlement`: a purchase
 * by the workspace or one of its members, or its own author). An assignment alone is not
 * proof of purchase, since any manager can write one.
 */
async function marketplaceSkillFor(db: Db, tenantId: number, slug: string) {
  const [row] = await db
    .select({
      id: marketplaceSkills.id,
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
  if (!row) return null;
  if (!row.published) {
    const [assigned] = await db
      .select({ slug: artifactAssignments.artifactSlug })
      .from(artifactAssignments)
      .where(and(eq(artifactAssignments.tenantId, tenantId), eq(artifactAssignments.artifactType, 'skill'), eq(artifactAssignments.artifactSlug, slug)))
      .limit(1);
    if (!assigned) return null;
  }
  if ((row.priceCents ?? 0) > 0 && !await hasPaidSkillEntitlement(db, tenantId, slug)) return null;
  return row;
}

async function resolveSkill(db: Db, tenantId: number, name: string, projectId: number | null | undefined): Promise<ResolvedSkill | null> {
  const own = await getApprovedSkillBySlug(db, tenantId, name, projectId);
  if (own) {
    return {
      name: own.slug, title: own.name, description: own.description, source: 'workspace',
      instructions: own.body, owner: { kind: 'workspace', id: own.id }, manifest: own.manifest,
    };
  }
  const listed = await marketplaceSkillFor(db, tenantId, name);
  if (listed) {
    return {
      name, title: listed.name, description: listed.description ?? '', source: 'marketplace',
      instructions: listed.readme ?? '', owner: { kind: 'marketplace', id: listed.id }, manifest: listed.manifest,
    };
  }
  const builtin = getBuiltinSkillBody(name);
  if (builtin) {
    return {
      name, title: builtin.name, description: builtin.description, source: 'builtin',
      instructions: builtin.readme, owner: null, manifest: null,
    };
  }
  return null;
}

async function miss(env: Env, db: Db, tenantId: number, projectId: number | null | undefined, error: string): Promise<SkillLibraryMiss> {
  const catalog = await skillLibraryCatalog(env, db, tenantId, projectId ?? null).catch((error: unknown) => {
    // The miss still answers; it just cannot name the alternatives.
    reportCaughtError(error, { source: 'application/skills/skillLibrary.ts', operation: 'readLibrarySkill.miss' });
    return [] as LibrarySkillSummary[];
  });
  return { ok: false, error, available: catalog.map((s) => s.name) };
}

/**
 * Load a skill (no `path`) or one of its bundled files (`path`). Never throws for a
 * miss: an unknown name or file comes back with what does exist.
 *
 * `projectId` is the caller's project scope: a number sees workspace-wide skills and
 * that project's, `null` sees workspace-wide only, and omitted means the caller has no
 * project context (a Brain chat, a workspace API key) and may load any approved skill.
 */
export async function readLibrarySkill(
  env: Env,
  db: Db,
  tenantId: number,
  name: string,
  path?: string | null,
  projectId?: number | null,
): Promise<LoadedLibrarySkill | LoadedSkillFile | SkillLibraryMiss> {
  const wanted = name.trim();
  if (!wanted) return miss(env, db, tenantId, projectId, 'name is required — pass a skill name from the catalog');
  const skill = await resolveSkill(db, tenantId, wanted, projectId);
  if (!skill) return miss(env, db, tenantId, projectId, `No skill named "${wanted}" is available to this workspace.`);

  if (path && path.trim() && path.trim() !== SKILL_FILE) {
    const safe = normalizeSkillPath(path);
    const content = safe && skill.owner ? await readSkillFile(db, skill.owner, safe) : null;
    if (content === null) {
      const files = skill.owner ? await listSkillFileEntries(db, skill.owner) : [];
      return { ok: false, error: `Skill "${skill.name}" has no file "${path}".`, available: files.map((f) => f.path) };
    }
    return { ok: true, name: skill.name, path: safe!, content };
  }

  const manifest = manifestFromRecord(skill.name, skill.description, skill.manifest);
  const files = skill.owner ? await listSkillFileEntries(db, skill.owner) : [];
  return {
    ok: true,
    name: skill.name,
    title: skill.title,
    description: skill.description,
    source: skill.source,
    instructions: skill.instructions,
    files,
    ...(manifest.license ? { license: manifest.license } : {}),
    ...(manifest.compatibility ? { compatibility: manifest.compatibility } : {}),
    ...(manifest.allowedTools ? { allowedTools: manifest.allowedTools } : {}),
  };
}

/**
 * A skill as a spec folder (SKILL.md first), for export and for the on-prem runtime
 * writing an assigned skill to disk. Null when the name resolves to nothing.
 */
export async function exportLibrarySkill(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  name: string,
  projectId?: number | null,
): Promise<{ name: string; files: SkillFile[] } | null> {
  const skill = await resolveSkill(db, tenantId, name.trim(), projectId);
  if (!skill) return null;
  const files = skill.owner ? await loadSkillFiles(db, skillAssetBucket(env), skill.owner) : [];
  return toSkillFolder({ name: skill.name, title: skill.title, description: skill.description, body: skill.instructions, manifest: skill.manifest, files });
}
