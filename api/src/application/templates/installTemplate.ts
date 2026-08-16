/**
 * Installing a template — the use case that turns a manifest plus a person's
 * answers into working things.
 *
 * Four acts, in this order and no other:
 *   1. RE-VALIDATE. The plan is resolved again, server-side, with every step
 *      treated as visited. The wizard already did this; doing it again is not
 *      redundancy, it is the only check that exists — the wizard's copy runs in
 *      a browser somebody can edit, and this is the one that decides.
 *   2. BIND. `{{setup.x}}` is substituted throughout the outputs, so a template
 *      stays pure data all the way to the point of writing.
 *   3. MATERIALISE. Each output is handed to its registered materialiser.
 *      Failures are COLLECTED, not thrown: an install is one user action that
 *      writes several things, and a fourth output failing must not leave the
 *      first three unexplained.
 *   4. RECORD. The install count on the catalogue row moves, so the storefront's
 *      "used 41,287 times" is a fact rather than a decoration.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems, projects } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { bindAnswers } from '../../domain/guidedSetup/guidedPlan';
import type { GuidedAnswers } from '../../domain/guidedSetup/guidedStep';
import type { TemplateOutput } from '../../domain/template/templateManifest';
import { outputKindSpec, type MaterializeOutputContext, type OutputResult } from './outputKinds';
import { invalidateTemplateCatalog, TEMPLATE_CATALOG_KIND, type ResolvedTemplate } from './templateRegistry';
import { resolveTemplateSetup } from './templateSetup';

export interface InstallTemplateArgs {
  db: Db;
  env: Env;
  tenantId: number;
  segmentId: string | null;
  template: ResolvedTemplate;
  answers: GuidedAnswers;
}

export type InstallTemplateResult =
  | {
      ok: false;
      /** Step ids still owed, so the wizard can jump straight to the first one. */
      blockedBy: string[];
      errors: Record<string, string>;
    }
  | {
      ok: true;
      outputs: OutputResult[];
      /** True when every output landed. False means "partly installed", which
       *  the caller must show — silently reporting success over a failed output
       *  is how somebody discovers a missing workflow a week later. */
      complete: boolean;
    };

/** The project the install files things under, from the answered project step. */
async function resolveProject(
  db: Db,
  tenantId: number,
  answers: GuidedAnswers,
): Promise<{ id: number; key: string } | null> {
  const raw = answers.project;
  const id = Number(typeof raw === 'string' || typeof raw === 'number' ? raw : NaN);
  if (!Number.isInteger(id)) return null;
  const [row] = await db
    .select({ id: projects.id, key: projects.key })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

/**
 * The run target for anything executable, from the answered agent step.
 *
 * The picker offers one list of "who runs this" with `cloud:` / `host:`
 * prefixes, so the split back into two columns happens exactly here rather than
 * in a second field a person has to keep consistent with the first.
 */
function resolveRunTarget(answers: GuidedAnswers): Pick<
  MaterializeOutputContext,
  'runTargetRuntime' | 'runTargetAgentHostId' | 'runTargetCloudAgentRef'
> {
  const raw = typeof answers.agent === 'string' ? answers.agent : '';
  if (raw.startsWith('cloud:')) {
    return { runTargetRuntime: 'cloud', runTargetAgentHostId: null, runTargetCloudAgentRef: raw.slice(6) };
  }
  if (raw.startsWith('host:')) {
    const id = Number(raw.slice(5));
    return {
      runTargetRuntime: 'host',
      runTargetAgentHostId: Number.isInteger(id) ? id : null,
      runTargetCloudAgentRef: null,
    };
  }
  // No agent was asked for. Cloud is the right default for a template: the
  // workspace may own no self-hosted host at all, and a `host` default would
  // install a workflow whose very first run fails on a missing agentHost.
  return { runTargetRuntime: 'cloud', runTargetAgentHostId: null, runTargetCloudAgentRef: null };
}

/**
 * Move the install counter on a stored template.
 *
 * DELIBERATELY CROSS-TENANT. The whole point of a marketplace template is that
 * another workspace installs it, and the row being counted belongs to the
 * PUBLISHER — scoping this write to the installing tenant would silently count
 * nothing for exactly the templates whose counts matter. The access predicate is
 * the id the registry already resolved plus the row's kind, and the only column
 * it can touch is a counter.
 *
 * Best-effort by design: a counter that failed to increment must never fail an
 * install that worked.
 */
async function recordInstall(db: Db, env: Env, tenantId: number, template: ResolvedTemplate): Promise<void> {
  if (!template.id) return; // built-ins have no row to count against
  try {
    await db
      .update(catalogItems)
      .set({ installCount: sql`${catalogItems.installCount} + 1`, updatedAt: new Date() })
      .where(acrossTenants(
        catalogItems,
        'public_catalogue',
        eq(catalogItems.id, template.id),
        eq(catalogItems.kind, TEMPLATE_CATALOG_KIND),
      ));
    await invalidateTemplateCatalog(env, tenantId);
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/templates/installTemplate.ts',
      operation: `recordInstall:${template.manifest.key}`,
    });
  }
}

export async function installTemplate(args: InstallTemplateArgs): Promise<InstallTemplateResult> {
  const { db, env, tenantId, segmentId, template, answers } = args;
  const { manifest } = template;

  // 1 — re-validate, with every step treated as visited.
  const touched = new Set(manifest.steps.map((s) => s.id));
  const { plan } = await resolveTemplateSetup(db, env, tenantId, manifest, answers, { touched });
  if (!plan.complete) {
    const errors: Record<string, string> = {};
    for (const resolved of plan.steps) {
      if (resolved.error) errors[resolved.step.id] = resolved.error;
    }
    return { ok: false, blockedBy: plan.blockedBy, errors };
  }

  // The effective values, not the raw ones: a step that was skipped still
  // contributes its declared default, and a binding must see the same value the
  // plan judged rather than an empty answer slot.
  const effective: GuidedAnswers = {};
  for (const resolved of plan.steps) effective[resolved.step.id] = resolved.value;

  // 2 — bind.
  const bound: TemplateOutput[] = bindAnswers(manifest.outputs, effective);

  // 3 — materialise.
  const project = await resolveProject(db, tenantId, effective);
  const ctx: MaterializeOutputContext = {
    db,
    env,
    tenantId,
    segmentId,
    projectId: project?.id ?? null,
    projectKey: project?.key ?? null,
    ...resolveRunTarget(effective),
  };

  const outputs: OutputResult[] = [];
  for (const output of bound) {
    const spec = outputKindSpec(output.kind);
    if (!spec) {
      // Only reachable if a manifest outlived a registry change; the contract
      // test asserts every declared kind has a materialiser.
      outputs.push({
        outputId: output.id,
        kind: output.kind,
        label: output.id,
        href: null,
        ref: null,
        detail: 'Not created',
        ok: false,
        error: `Nothing knows how to install a "${output.kind}" output.`,
      });
      continue;
    }
    outputs.push(await spec.materialize(output, ctx));
  }

  // 4 — record.
  await recordInstall(db, env, tenantId, template);

  return { ok: true, outputs, complete: outputs.every((o) => o.ok) };
}
