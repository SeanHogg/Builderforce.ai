/**
 * IDE starter-template seeding — single source of truth.
 *
 * The in-browser IDE stores a project's files in R2 under
 * `ide/projects/{projectId}/`. A freshly-created project must open with a
 * runnable scaffold, not empty files (empty files forced the Run pipeline onto
 * run-only defaults that were never persisted). This module owns BOTH the
 * template content and the decision of when to seed it, so the creation routes
 * ([projectRoutes]) and the lazy self-heal on file-list ([ideRoutes]) share one
 * implementation instead of duplicating the template + gate logic.
 *
 * Seeding is NON-DESTRUCTIVE: it only writes when the project's IDE workspace
 * looks unseeded (no template file present with content), so it can run safely
 * on every file-list without ever clobbering a user's real work.
 */

import {
  MOBILE_TEMPLATE,
  TEMPLATES,
  VANILLA_TEMPLATE,
  templateForModality,
} from '@builderforce/ide-templates';

export const IDE_PREFIX = 'ide/';

/** Re-exported so existing importers of the scaffolds keep one import site. */
export { VANILLA_TEMPLATE, MOBILE_TEMPLATE, TEMPLATES };

/** The project fields the seeding decision needs. A `Project` domain instance
 *  satisfies this structurally (its getters expose these names). */
export interface SeedableProject {
  id: number;
  template: string | null;
  modality: string | null;
  sourceControlRepoFullName: string | null;
  githubRepoUrl: string | null;
}

/** A template-relative R2 object with its byte size. */
export interface TemplateObject {
  path: string;
  size: number;
}

/**
 * The scaffold for a project's MODALITY (or explicit template), ignoring whether
 * a repo is linked. This is the "what should a runnable Mobile/Designer project
 * contain" answer; the repo-link decision belongs to the callers below.
 */
export function scaffoldForProject(project: SeedableProject): Record<string, string> | null {
  const explicit = project.template ? TEMPLATES[project.template] : undefined;
  return explicit ?? templateForModality(project.modality);
}

/**
 * The starter template this project should be seeded with on creation, or null
 * when it should be left alone.
 *
 * An explicit `template` wins. Otherwise the modality decides: Designer gets the
 * vanilla Vite app, Mobile gets the React Native scaffold, and the generative
 * modalities (video/evermind/finetune/voice) get nothing because they never run
 * the Vite app.
 *
 * Repo-connected projects are skipped HERE — a project the user pointed at an
 * existing repo shouldn't have a Vite scaffold sprayed over it on creation. This
 * is NOT the same as "never seed": {@link ensureRunnableScaffold} still fills a
 * repo-linked project's missing scaffold when its workspace comes up empty (e.g.
 * a freshly auto-created backing repo that only has a README), so a project is
 * never left unrunnable — that gap is exactly what wiped Mobile workspaces.
 *
 * An UNRECOGNISED `template` falls through to the modality instead of returning
 * null. A stale id (from a retired starter set, or one an older create path
 * wrote) used to mean "seed nothing", which left the workspace permanently empty.
 */
export function templateForProject(project: SeedableProject): Record<string, string> | null {
  const explicit = project.template ? TEMPLATES[project.template] : undefined;
  if (explicit) return explicit;
  const hasRepo = !!(project.sourceControlRepoFullName || project.githubRepoUrl);
  if (hasRepo) return null;
  return scaffoldForProject(project);
}

/** Files belonging to any known template, used by the project-less gates below. */
const ALL_TEMPLATE_PATHS = new Set(Object.values(TEMPLATES).flatMap((t) => Object.keys(t)));

/**
 * The project's IDE workspace looks FULLY unseeded when NO template file is
 * present with content — i.e. it is freshly-created (no objects) or legacy (the
 * template paths exist but are empty). Used to decide whether to import a linked
 * repo's files (only worthwhile for a brand-new/empty workspace).
 */
export function templateLooksUnseeded(objects: TemplateObject[]): boolean {
  return !objects.some((o) => o.size > 0 && ALL_TEMPLATE_PATHS.has(o.path));
}

/**
 * Whether NO known template is fully present, so the workspace MIGHT need
 * seeding. A partially-seeded project (e.g. `package.json` has content but
 * `src/main.jsx` is a 0-byte placeholder) must still get its empty files healed,
 * or they open BLANK in the editor — `templateLooksUnseeded` (all-empty) is the
 * strict subset that misses exactly this case, which is why backfill keys off
 * this instead.
 *
 * This is deliberately a cheap, project-less SUPERSET check: it runs on every
 * file-list, before the project lookup, so a healthy workspace pays nothing. It
 * must therefore clear a complete workspace of ANY template — checking only the
 * vanilla paths would flag every healthy Mobile project as needing backfill and
 * charge it a project lookup on every request. The precise per-modality decision
 * belongs to `ensureProjectTemplate`, which knows the project.
 */
export function templateNeedsBackfill(objects: TemplateObject[]): boolean {
  const sizeByPath = new Map(objects.map((o) => [o.path, o.size]));
  const isComplete = (template: Record<string, string>) =>
    Object.keys(template).every((path) => (sizeByPath.get(path) ?? 0) > 0);
  return !Object.values(TEMPLATES).some(isComplete);
}

/** Write the template files that are missing or empty. Returns count written. */
async function writeMissingTemplateFiles(
  storage: R2Bucket,
  projectId: number,
  template: Record<string, string>,
  existing: TemplateObject[],
): Promise<number> {
  const prefix = `${IDE_PREFIX}projects/${projectId}/`;
  const sizeByPath = new Map(existing.map((o) => [o.path, o.size]));
  const toWrite = Object.entries(template).filter(([path]) => {
    const size = sizeByPath.get(path);
    return size === undefined || size === 0;
  });
  if (toWrite.length === 0) return 0;
  await Promise.all(toWrite.map(([path, content]) => storage.put(prefix + path, content)));
  return toWrite.length;
}

/**
 * Ensure the project's starter template exists. Self-contained: picks the
 * template for the project's modality, lists R2, and seeds only the files that
 * are missing or empty. Safe to call on creation AND lazily on open. Returns
 * files written.
 *
 * Callers on a hot read path (file-list) that have ALREADY listed the prefix
 * should pass `preListed` to avoid a redundant R2 list.
 */
export async function ensureProjectTemplate(
  storage: R2Bucket | undefined,
  project: SeedableProject,
  preListed?: TemplateObject[],
): Promise<number> {
  const template = storage ? templateForProject(project) : null;
  if (!storage || !template) return 0;
  let existing = preListed;
  if (!existing) {
    const prefix = `${IDE_PREFIX}projects/${project.id}/`;
    const listed = await storage.list({ prefix });
    existing = (listed.objects ?? []).map((o) => ({ path: o.key.replace(prefix, ''), size: o.size }));
  }
  // Backfill whenever a file of THIS project's template is missing or empty —
  // not only when the whole workspace is unseeded. This heals partial-empty
  // projects (the blank-editor bug) while `writeMissingTemplateFiles` still
  // never clobbers a file that already has content.
  return writeMissingTemplateFiles(storage, project.id, template, existing);
}

/**
 * Guarantee the project is RUNNABLE — seed the modality scaffold's missing/empty
 * files EVEN when a repo is linked. Unlike {@link ensureProjectTemplate} (which
 * deliberately leaves repo-linked projects to git), this exists for the one case
 * that wiped workspaces: a project bound to an effectively-empty backing repo
 * (auto-created with just a README, or a first push that found R2 empty and
 * bailed). It only fires when the workspace has NO real `package.json`, so a
 * genuine imported repo — which brings its own package.json — is never touched,
 * and `writeMissingTemplateFiles` never overwrites a file that has content.
 *
 * Returns files written (0 when the workspace already has a real package.json or
 * the modality has no scaffold).
 */
export async function ensureRunnableScaffold(
  storage: R2Bucket | undefined,
  project: SeedableProject,
  preListed?: TemplateObject[],
): Promise<number> {
  const template = storage ? scaffoldForProject(project) : null;
  if (!storage || !template) return 0;
  let existing = preListed;
  if (!existing) {
    const prefix = `${IDE_PREFIX}projects/${project.id}/`;
    const listed = await storage.list({ prefix });
    existing = (listed.objects ?? []).map((o) => ({ path: o.key.replace(prefix, ''), size: o.size }));
  }
  // A real, non-empty package.json means real code lives here (seeded scaffold OR
  // an imported repo) — leave it alone. Only a workspace WITHOUT one is the
  // "bare/empty backing repo" case this heals.
  const hasRealPackageJson = existing.some((o) => o.path === 'package.json' && o.size > 0);
  if (hasRealPackageJson) return 0;
  return writeMissingTemplateFiles(storage, project.id, template, existing);
}
