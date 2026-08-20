/**
 * What installing a template WRITES — one registered materialiser per output
 * kind, and the framework's second extension point.
 *
 * The manifest contract (`domain/template/templateManifest`) owns an output's
 * SHAPE, because a shape can be validated with no database and a publisher's
 * manifest has to be checkable before anything is installed. This module owns
 * its EFFECT. A new output kind — publish a dashboard, provision a mailbox,
 * seed a knowledge base — is a variant plus a `registerOutputKind` call, not an
 * edit to the installer.
 *
 * Every materialiser is IDEMPOTENT-BY-INTENT and reports what it did rather than
 * throwing: installing a template is one user action that may write several
 * things, and a fourth output failing must not roll the first three back into an
 * unexplained half-state. The installer collects the results and shows a person
 * exactly what landed and what did not.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { formatTaskKey, nextProjectKeySeqBase } from '../task/taskKeys';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { createWorkflowDefinition, coerceRunTarget } from '../workflow/definitionStore';
import type {
  TasksOutput,
  TemplateOutput,
  TemplateOutputKind,
  WorkflowOutput,
} from '../../domain/template/templateManifest';

/** What one materialiser produced. `ref` is the created row's id, so the UI can
 *  link straight to the thing rather than telling somebody to go and look. */
export interface OutputResult {
  outputId: string;
  kind: TemplateOutputKind;
  label: string;
  /** Where to send a person — a route on this product, when there is one. */
  href: string | null;
  ref: string | null;
  /** Human-readable summary, e.g. "6 tickets seeded, 2 already on the board". */
  detail: string;
  ok: boolean;
  error?: string;
}

/** Everything a materialiser is allowed to reach for. Narrow on purpose: an
 *  output that needed the whole request context would be a use case, not data. */
export interface MaterializeOutputContext {
  db: Db;
  env: Env;
  tenantId: number;
  segmentId: string | null;
  /** Project the install files things under, when the setup collected one. */
  projectId: number | null;
  projectKey: string | null;
  /** Run target for anything executable the template creates. */
  runTargetRuntime: 'host' | 'cloud';
  runTargetAgentHostId: number | null;
  runTargetCloudAgentRef: string | null;
}

export interface OutputKindSpec<O extends TemplateOutput = TemplateOutput> {
  kind: O['kind'];
  materialize(output: O, ctx: MaterializeOutputContext): Promise<OutputResult>;
}

const REGISTRY = new Map<TemplateOutputKind, OutputKindSpec<never>>();

/** Register (or replace) the materialiser for an output kind. */
export function registerOutputKind<O extends TemplateOutput>(spec: OutputKindSpec<O>): void {
  REGISTRY.set(spec.kind, spec as unknown as OutputKindSpec<never>);
}

export function outputKindSpec(kind: string): OutputKindSpec<TemplateOutput> | null {
  return (REGISTRY.get(kind as TemplateOutputKind) as OutputKindSpec<TemplateOutput> | undefined) ?? null;
}

export function registeredOutputKinds(): TemplateOutputKind[] {
  return [...REGISTRY.keys()];
}

// ---------------------------------------------------------------------------
// workflow
// ---------------------------------------------------------------------------

registerOutputKind<WorkflowOutput>({
  kind: 'workflow',
  async materialize(output, ctx) {
    const base: Omit<OutputResult, 'ok' | 'detail' | 'href' | 'ref'> = {
      outputId: output.id,
      kind: 'workflow',
      label: output.name,
    };
    try {
      const row = await createWorkflowDefinition(ctx.db, ctx.env, {
        tenantId: ctx.tenantId,
        segmentId: ctx.segmentId,
        name: output.name,
        description: output.description ?? null,
        projectId: ctx.projectId,
        definition: output.definition,
        target: coerceRunTarget({
          runTargetRuntime: ctx.runTargetRuntime,
          runTargetAgentHostId: ctx.runTargetAgentHostId,
          runTargetCloudAgentRef: ctx.runTargetCloudAgentRef,
        }),
      });
      const triggers = output.definition.nodes.filter((n) => n.kind === 'trigger').length;
      return {
        ...base,
        ok: true,
        ref: row.id,
        href: `/workflows/builder?id=${row.id}`,
        detail: `${output.definition.nodes.length} steps${triggers ? `, ${triggers} trigger${triggers === 1 ? '' : 's'} armed` : ''}`,
      };
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/templates/outputKinds.ts',
        operation: `materialize:workflow:${output.id}`,
      });
      return {
        ...base,
        ok: false,
        ref: null,
        href: null,
        detail: 'Not created',
        error: error instanceof Error ? error.message : 'Could not create the workflow',
      };
    }
  },
});

// ---------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------

registerOutputKind<TasksOutput>({
  kind: 'tasks',
  async materialize(output, ctx) {
    const base = { outputId: output.id, kind: 'tasks' as const, label: output.label };
    if (!ctx.projectId || !ctx.projectKey) {
      // The manifest parser requires a project step precisely so this cannot
      // normally happen; the guard stays because an install can be replayed
      // against answers whose project was deleted in between.
      return {
        ...base,
        ok: false,
        ref: null,
        href: null,
        detail: 'Not seeded',
        error: 'No project selected to file this work under.',
      };
    }

    // Titles already on the board are SKIPPED, not duplicated: re-installing a
    // template to pick up a new step must converge on one checklist rather than
    // seeding a second copy of every ticket.
    const existing = await ctx.db
      .select({ title: tasks.title })
      .from(tasks)
      .where(eq(tasks.projectId, ctx.projectId));
    const seen = new Set(existing.map((t) => t.title.trim().toLowerCase()));

    let seq = await nextProjectKeySeqBase(ctx.db, ctx.projectId);
    let created = 0;
    let skipped = 0;

    for (const item of [...output.items].sort((a, b) => a.order - b.order)) {
      if (seen.has(item.title.trim().toLowerCase())) {
        skipped += 1;
        continue;
      }
      let inserted = false;
      for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
        try {
          await ctx.db.insert(tasks).values({
            projectId: ctx.projectId,
            key: formatTaskKey(ctx.projectKey, seq),
            title: item.title.slice(0, 500),
            description: item.description,
            status: 'backlog',
            priority: 'medium',
          });
          inserted = true;
          created += 1;
          seen.add(item.title.trim().toLowerCase());
        } catch (error) {
          // Almost certainly a key collision with a concurrent create — walk on.
          reportCaughtError(error, {
            source: 'application/templates/outputKinds.ts',
            operation: `materialize:tasks:${item.title.slice(0, 40)}`,
          });
        } finally {
          seq += 1;
        }
      }
    }

    return {
      ...base,
      ok: true,
      ref: String(ctx.projectId),
      href: `/kanban?project=${ctx.projectId}`,
      detail: skipped
        ? `${created} seeded, ${skipped} already on the board`
        : `${created} seeded`,
    };
  },
});
