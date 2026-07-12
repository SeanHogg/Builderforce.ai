/**
 * Evermind recipes — the one-click starting points a user picks when creating an
 * LLM ("Evermind") project. A recipe is a create-time CONFIGURATOR: it decides how
 * the new project's per-project Evermind ([[evermind-learning-architecture]]) is
 * provisioned so the project opens with a working, learnable model instead of
 * forcing the user to hand-author an (unrelated) automation workflow first.
 *
 * The RESULT of a recipe is the persisted Evermind state (seeded base + version,
 * teacher, mode, inference flag) — there is no separate "recipe" column, so no
 * migration is needed. The frontend owns the display catalog (labels/icons); this
 * module owns the behavior, and both agree on the id set below.
 *
 * All application here is BEST-EFFORT: project creation must succeed even if the
 * artifact store is unavailable, so `applyEvermindRecipe` never throws.
 */
import { EvermindModelPackage } from '@seanhogg/builderforce-memory-engine';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveTenantModel, TENANT_MODEL_REF_PREFIX } from './tenantModelService';
import { assessEvermindCoherence, type ArtifactStore } from './evermindRuntime';
import {
  provisionDefaultProjectEvermind,
  seedProjectEvermind,
  setProjectEvermindTeacher,
  setProjectEvermindInference,
} from './projectEvermind';

/** The canonical recipe ids. Kept in lockstep with `frontend/src/lib/evermindRecipes.ts`. */
export const EVERMIND_RECIPE_IDS = ['coding', 'assistant', 'docs', 'seed-published', 'blank'] as const;
export type EvermindRecipeId = (typeof EVERMIND_RECIPE_IDS)[number];

/** The recipe applied when creation supplies an unknown/missing id. */
export const DEFAULT_EVERMIND_RECIPE: EvermindRecipeId = 'coding';

export function isEvermindRecipeId(x: unknown): x is EvermindRecipeId {
  return typeof x === 'string' && (EVERMIND_RECIPE_IDS as readonly string[]).includes(x);
}

/** Coerce arbitrary input into a valid recipe id (defaulting), so callers never branch. */
export function toEvermindRecipeId(x: unknown): EvermindRecipeId {
  return isEvermindRecipeId(x) ? x : DEFAULT_EVERMIND_RECIPE;
}

export interface EvermindRecipeInput {
  recipe: EvermindRecipeId;
  /** Frontier-LLM teacher to distil runs through (any gateway model id). Applied
   *  only for the starter-base recipes; ignored when seeding a published model. */
  teacherModel?: string | null;
  /** For `seed-published`: the published Studio Evermind model slug to clone from. */
  seedModelSlug?: string | null;
  /** Display name for the project's Evermind. */
  name?: string;
}

export interface SeedFromPublishedResult {
  ok: boolean;
  version: number;
  error?: string;
}

/**
 * Seed a project's base Evermind (version 1) from an ALREADY-PUBLISHED Studio model
 * (by slug). Server-side R2 copy — reads the published model's two objects and seeds
 * the project base without the browser round-tripping the blob. Extracted here so
 * BOTH the `/seed-from-model` route and recipe application share one implementation.
 */
export async function seedProjectEvermindFromPublished(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  slug: string,
  name?: string,
): Promise<SeedFromPublishedResult> {
  if (!env.UPLOADS) return { ok: false, version: 0, error: 'R2 artifact storage not configured' };
  const clean = slug.trim();
  if (!clean) return { ok: false, version: 0, error: 'slug is required' };

  // Resolve the published model → its immutable R2 ref (tenant-scoped, so no IDOR).
  const tm = await resolveTenantModel(env, db, tenantId, `${TENANT_MODEL_REF_PREFIX}${clean}`);
  if (!tm || !tm.baseModel?.startsWith('evermind/')) {
    return { ok: false, version: 0, error: 'no published Evermind model with that slug' };
  }
  const ref = tm.baseModel.slice('evermind/'.length);

  const [modelObj, tokObj] = await Promise.all([
    env.UPLOADS.get(`${ref}/model.evermind`),
    env.UPLOADS.get(`${ref}/tokenizer.json`),
  ]);
  if (!modelObj) return { ok: false, version: 0, error: 'published model artifact not found in storage' };
  if (!tokObj) return { ok: false, version: 0, error: 'published model tokenizer not found in storage' };

  const modelBlob = await modelObj.arrayBuffer();
  const verdict = EvermindModelPackage.fromBlob(modelBlob).validate();
  if (!verdict.ok) return { ok: false, version: 0, error: `invalid .evermind artifact: ${verdict.errors.join('; ')}` };
  const tokenizer = (await tokObj.json().catch(() => null)) as { vocab?: unknown; merges?: unknown } | null;
  if (!tokenizer || typeof tokenizer.vocab !== 'object' || !Array.isArray(tokenizer.merges)) {
    return { ok: false, version: 0, error: 'published model tokenizer is malformed' };
  }

  const head = await seedProjectEvermind(env, db, env.UPLOADS, {
    tenantId,
    projectId,
    name: name?.trim() || tm.name || undefined,
    modelBlob,
    tokenizer: { vocab: tokenizer.vocab as Record<string, number>, merges: tokenizer.merges as string[] },
  });
  return { ok: true, version: head.version };
}

/**
 * Apply a recipe to a freshly-created project so it opens with a working Evermind.
 *
 *   seed-published → clone a published model as the base + enable inference (it is a
 *                    real trained model, so it is safe to run agents on immediately);
 *                    falls back to a starter base if the slug can't be resolved.
 *   coding|assistant|docs|blank → provision a learnable STARTER base (always gives
 *                    the project a model to teach/benchmark), optionally pinning a
 *                    frontier teacher to distil through. Inference stays OFF until
 *                    the manager opts in — a random starter isn't run silently.
 *
 * Best-effort: never throws. A transient store/DB failure just leaves the project
 * without a starter model yet (the Studio panel can seed later).
 */
export async function applyEvermindRecipe(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  input: EvermindRecipeInput,
): Promise<void> {
  try {
    if (input.recipe === 'seed-published' && input.seedModelSlug?.trim()) {
      const seeded = await seedProjectEvermindFromPublished(env, db, tenantId, projectId, input.seedModelSlug, input.name);
      if (seeded.ok) {
        // A published model is already trained → running the project's agents on it
        // is meaningful, so turn on inference (mode defaults to 'connected' on seed) —
        // BUT still benchmark-gate it (same bar as the manual toggle), so a published
        // model that can't actually hold coherent chat isn't auto-promoted to serve.
        // If it fails the probe, inference just stays OFF (the seeded model is still
        // there; a manager can force-enable later). Store-less env → enable ungated.
        const store = env.UPLOADS as ArtifactStore | undefined;
        await setProjectEvermindInference(env, db, tenantId, projectId, true, store ? { assessReadiness: (ref) => assessEvermindCoherence(store, ref) } : undefined);
        return;
      }
      // Slug unresolvable — degrade to a starter base rather than a dead project.
    }

    // Starter-base recipes (and the seed-published fallback): always leave a model.
    await provisionDefaultProjectEvermind(env, db, tenantId, projectId, input.name);
    if (input.teacherModel?.trim()) {
      await setProjectEvermindTeacher(env, db, tenantId, projectId, input.teacherModel.trim());
    }
  } catch {
    /* best-effort: project creation must succeed even if Evermind provisioning fails */
  }
}
