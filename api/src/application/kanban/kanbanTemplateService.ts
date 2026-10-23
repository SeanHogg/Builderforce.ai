/**
 * Kanban template service — the spine of the Agentic Workforce Kanban.
 *
 * Merges built-in templates (code) with tenant-authored / forked / installed
 * templates — `catalog_items` rows of kind 'kanban_template' (migration 1263),
 * read and written through the ONE templates store
 * (`templates/catalogTemplateStore.ts`), with the lanes + requirements in the
 * row's body (`kanbanTemplateCodec.ts`). Applying a template materialises its
 * lanes onto a project's board swimlanes and its per-lane requirements onto
 * swimlane_requirements, so the live board is self-describing for the audit +
 * gating engines. Also powers the marketplace (publish / list public / install a
 * public template into your tenant).
 *
 * Reads are cached by the store under version tokens every write bumps.
 */
import { eq } from 'drizzle-orm';
import {
  boards,
  projects,
  swimlaneRequirements,
  swimlanes,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { findOrCreateBoard } from '../swimlane/findOrCreateBoard';
import { isParkedLane } from '../swimlane/nextLane';
import { seedLaneStaffingFromWorkforce } from '../swimlane/seedLaneStaffing';
import { BUILTIN_TEMPLATES, getBuiltinTemplate, isBuiltinTemplateId } from './templateCatalog';
import type { KanbanTemplate, TemplateLane, TemplateVisibility } from './types';
import { slugify as slugifyBase } from '@builderforce/creation-canvas-contract';
import { invalidateSwimlaneOrdinals } from '../swimlane/laneOrdinals';
import { invalidateBoardLanesCache } from '../swimlane/boardReads';
import {
  deleteTemplateRow,
  getPublicTemplate,
  getTenantTemplate,
  insertTemplate,
  listPublicTemplates,
  listTenantTemplates,
  recordTemplateInstall,
  updateTemplate,
  type TemplateValues,
} from '../templates/catalogTemplateStore';
import { TEMPLATE_KINDS } from '../templates/templateKinds';
import { kanbanBodyOf, kanbanPriceValues, kanbanTemplateFromStored, parseKanbanBody } from './kanbanTemplateCodec';

const KIND = TEMPLATE_KINDS.kanban;

function slugify(input: string): string {
  return slugifyBase(input, { maxLength: 110, fallback: 'template' });
}

/** A lightweight card for list views (no lanes). */
export interface TemplateSummary {
  id: string;
  slug: string;
  name: string;
  description?: string;
  category: string;
  teamType?: string;
  builtin: boolean;
  visibility: TemplateVisibility;
  published: boolean;
  priceCents?: number | null;
  installCount: number;
  laneCount: number;
  roleCount: number;
}

function summarize(t: KanbanTemplate): TemplateSummary {
  const roles = new Set<string>();
  for (const l of t.lanes) for (const r of l.requirements) if (r.kind === 'role' || r.kind === 'review') roles.add(r.ref);
  return {
    id: t.id, slug: t.slug, name: t.name, description: t.description, category: t.category,
    teamType: t.teamType, builtin: t.builtin, visibility: t.visibility, published: t.published,
    priceCents: t.priceCents ?? null, installCount: t.installCount, laneCount: t.lanes.length, roleCount: roles.size,
  };
}

export class KanbanTemplateService {
  constructor(private readonly db: Db) {}

  /** Built-ins + this tenant's templates, as summaries. */
  async list(env: Env, tenantId: number): Promise<TemplateSummary[]> {
    const rows = await listTenantTemplates(this.db, env, { tenantId, kind: KIND });
    return [...BUILTIN_TEMPLATES.map(summarize), ...rows.map((r) => summarize(kanbanTemplateFromStored(r, tenantId)))];
  }

  /** Public marketplace listings (every workspace's published templates + built-ins). */
  async listPublic(env: Env): Promise<TemplateSummary[]> {
    const rows = await listPublicTemplates(this.db, env, { kind: KIND, scope: 'all' });
    return [...BUILTIN_TEMPLATES.map(summarize), ...rows.map((r) => summarize(kanbanTemplateFromStored(r, null)))];
  }

  /** Full template (built-in or tenant-owned or a public one being previewed). */
  async get(env: Env, tenantId: number, id: string): Promise<KanbanTemplate | null> {
    if (isBuiltinTemplateId(id)) return getBuiltinTemplate(id) ?? null;
    const own = await getTenantTemplate(this.db, env, { tenantId, kind: KIND, id });
    if (own) return kanbanTemplateFromStored(own, tenantId);
    // Fall back to a public template (for marketplace preview / install).
    const pub = await getPublicTemplate(this.db, env, { kind: KIND, id });
    return pub ? kanbanTemplateFromStored(pub, tenantId) : null;
  }

  /** Create a new tenant template (optionally forked from a built-in / existing one). */
  async create(
    env: Env,
    tenantId: number,
    authorId: string | null,
    input: Partial<KanbanTemplate> & { name: string; lanes?: TemplateLane[]; forkFrom?: string },
  ): Promise<KanbanTemplate> {
    const name = input.name?.trim();
    if (!name) throw new Error('name is required');

    let lanes = input.lanes;
    let parentTemplateId: string | null = input.parentTemplateId ?? null;
    if (input.forkFrom) {
      const src = await this.get(env, tenantId, input.forkFrom);
      if (!src) throw new Error(`template '${input.forkFrom}' not found`);
      lanes = lanes ?? src.lanes;
      parentTemplateId = src.id;
    }

    const id = crypto.randomUUID();
    await insertTemplate(this.db, env, {
      tenantId,
      kind: KIND,
      id,
      values: {
        slug: slugify(input.slug || name) + '-' + id.slice(0, 6),
        name,
        summary: input.description ?? null,
        category: input.category ?? 'software',
        version: '1',
        visibility: 'private',
        publishedAt: null,
        createdBy: authorId,
        ...kanbanPriceValues(input.priceCents ?? null),
        body: kanbanBodyOf({
          teamType: input.teamType ?? null,
          parentTemplateId,
          pricingModel: input.pricingModel ?? null,
          priceUnit: input.priceUnit ?? null,
          lanes: lanes ?? [],
        }),
      },
    });
    return (await this.get(env, tenantId, id))!;
  }

  async update(
    env: Env,
    tenantId: number,
    id: string,
    input: Partial<KanbanTemplate> & { lanes?: TemplateLane[] },
  ): Promise<KanbanTemplate> {
    if (isBuiltinTemplateId(id)) throw new Error('built-in templates cannot be edited — fork it first');
    const existing = await getTenantTemplate(this.db, env, { tenantId, kind: KIND, id });
    if (!existing) throw new Error(`template '${id}' not found`);
    const body = parseKanbanBody(existing.body);
    const values: TemplateValues = {
      ...kanbanPriceValues(input.priceCents),
      body: kanbanBodyOf({
        teamType: input.teamType !== undefined ? input.teamType || null : body.teamType,
        parentTemplateId: body.parentTemplateId,
        legacyId: body.legacyId,
        pricingModel: input.pricingModel !== undefined ? input.pricingModel || null : body.pricingModel,
        priceUnit: input.priceUnit !== undefined ? input.priceUnit || null : body.priceUnit,
        lanes: input.lanes ?? body.lanes,
      }),
    };
    if (input.name) values.name = input.name.trim();
    if (input.description !== undefined) values.summary = input.description || null;
    if (input.category) values.category = input.category;
    await updateTemplate(this.db, env, { tenantId, kind: KIND, match: { id }, values });
    return (await this.get(env, tenantId, id))!;
  }

  async remove(env: Env, tenantId: number, id: string): Promise<void> {
    if (isBuiltinTemplateId(id)) throw new Error('built-in templates cannot be deleted');
    await deleteTemplateRow(this.db, env, { tenantId, kind: KIND, match: { id } });
  }

  /** Publish / unpublish a tenant template to the marketplace. */
  async setPublication(
    env: Env,
    tenantId: number,
    id: string,
    opts: { published: boolean; visibility?: TemplateVisibility; priceCents?: number | null; pricingModel?: string | null; priceUnit?: string | null },
  ): Promise<void> {
    if (isBuiltinTemplateId(id)) throw new Error('built-in templates are already public');
    const existing = await getTenantTemplate(this.db, env, { tenantId, kind: KIND, id });
    if (!existing) throw new Error(`template '${id}' not found`);
    const values: TemplateValues = {
      // Re-publishing keeps the original publish date; unpublishing clears it.
      publishedAt: opts.published ? new Date(existing.publishedAt ?? Date.now()) : null,
      visibility: opts.visibility ?? (opts.published ? 'public' : 'private'),
      ...kanbanPriceValues(opts.priceCents),
    };
    if (opts.pricingModel !== undefined || opts.priceUnit !== undefined) {
      const body = parseKanbanBody(existing.body);
      values.body = kanbanBodyOf({
        ...body,
        pricingModel: opts.pricingModel !== undefined ? opts.pricingModel : body.pricingModel,
        priceUnit: opts.priceUnit !== undefined ? opts.priceUnit : body.priceUnit,
      });
    }
    await updateTemplate(this.db, env, { tenantId, kind: KIND, match: { id }, values });
  }

  /** Install a public template (built-in or another tenant's) as a private copy. */
  async install(env: Env, tenantId: number, authorId: string | null, sourceId: string): Promise<KanbanTemplate> {
    const src = await this.get(env, tenantId, sourceId);
    if (!src) throw new Error(`template '${sourceId}' not found`);
    const copy = await this.create(env, tenantId, authorId, {
      name: src.name,
      description: src.description,
      category: src.category,
      teamType: src.teamType,
      lanes: src.lanes,
      parentTemplateId: src.id,
    });
    // Count the install against the source row (built-ins live in code: a no-op).
    if (!isBuiltinTemplateId(sourceId)) await recordTemplateInstall(this.db, env, { kind: KIND, id: sourceId });
    return copy;
  }

  /**
   * Apply a template to a project: materialise its lanes onto the board's
   * swimlanes (upsert by key — never deletes lanes, to avoid orphaning tasks) and
   * replace the board's swimlane_requirements with the template's per-lane
   * requirements. Records provenance on board + project.
   */
  async applyToProject(
    env: Env,
    tenantId: number,
    projectId: number,
    templateId: string,
    projectName: string,
  ): Promise<{ boardId: string; lanesApplied: number; requirementsApplied: number; lanesStaffed: number }> {
    const template = await this.get(env, tenantId, templateId);
    if (!template) throw new Error(`template '${templateId}' not found`);

    const { board: realBoard } = await findOrCreateBoard(this.db, {
      tenantId, projectId, name: projectName, seedDefaultLanes: false,
    });
    const boardId = realBoard.id;
    const now = new Date();

    const existingLanes = await this.db
      .select({ id: swimlanes.id, key: swimlanes.key })
      .from(swimlanes)
      .where(scopedToTenant(swimlanes, tenantId, eq(swimlanes.boardId, boardId)));
    const laneByKey = new Map(existingLanes.map((l) => [l.key, l.id]));

    // Every write below goes into ONE db.batch — a single round trip, atomic — in the
    // same per-lane order the statements used to run one by one (lane upsert, then its
    // requirements replaced), followed by the board/project provenance stamps.
    const writes: unknown[] = [];
    let requirementsApplied = 0;
    for (const lane of template.lanes) {
      let laneId = laneByKey.get(lane.key);
      if (laneId) {
        writes.push(this.db
          .update(swimlanes)
          .set({
            name: lane.name, position: lane.position, isTerminal: lane.isTerminal,
            // APPLYING A TEMPLATE IS AN OPERATOR CHOICE (DISP-R2). Someone picked
            // this template for this board; its gates are as deliberate as one set
            // by hand, and a future default change must not overwrite them the way
            // 0369 had to overwrite the seeded ones.
            gate: lane.gate, gateSource: 'operator',
            // PARKED (1080): a template's blocked/on-hold lane is off the delivery path.
            // Derived from the lane KEY because `TemplateLane` carries no flag of its
            // own — the same seeded rule migration 1080 backfilled with.
            isParking: isParkedLane(lane.key),
            requirementGate: lane.requirementGate, updatedAt: now,
          })
          .where(scopedToTenant(swimlanes, tenantId, eq(swimlanes.id, laneId))));
      } else {
        laneId = crypto.randomUUID();
        writes.push(this.db.insert(swimlanes).values({
          id: laneId, tenantId, segmentId: realBoard.segmentId ?? null, boardId,
          key: lane.key, name: lane.name, position: lane.position, isTerminal: lane.isTerminal,
          isParking: isParkedLane(lane.key),
          gate: lane.gate, gateSource: 'operator', requirementGate: lane.requirementGate,
          executionMode: 'sequential', failurePolicy: 'needs_attention',
          createdAt: now, updatedAt: now,
        }));
        laneByKey.set(lane.key, laneId);
      }
      // Replace this lane's live requirements with the template's.
      writes.push(this.db.delete(swimlaneRequirements).where(scopedToTenant(swimlaneRequirements, tenantId, eq(swimlaneRequirements.swimlaneId, laneId))));
      if (lane.requirements.length) {
        writes.push(this.db.insert(swimlaneRequirements).values(
          lane.requirements.map((r) => ({
            id: crypto.randomUUID(), tenantId, swimlaneId: laneId!,
            kind: r.kind, ref: r.ref, responsibility: r.responsibility ?? null,
            isRequired: r.isRequired, description: r.description ?? null, position: r.position,
            ticketType: r.ticketType ?? null, quorum: r.quorum ?? null, condition: r.condition ?? null,
            createdAt: now,
          })),
        ));
        requirementsApplied += lane.requirements.length;
      }
    }

    // A lifecycle-managed template (PRD §5.5) flips the board into Coordinator mode
    // (assignee = Coordinator, never the default executor); re-applying a legacy
    // template turns it back off, so the flag always tracks the applied template.
    writes.push(this.db.update(boards).set({ templateId, lifecycleManaged: template.lifecycleManaged === true, updatedAt: now }).where(scopedToTenant(boards, tenantId, eq(boards.id, boardId))));
    writes.push(this.db.update(projects).set({ kanbanTemplateId: templateId, updatedAt: now }).where(scopedToTenant(projects, tenantId, eq(projects.id, projectId))));
    await this.db.batch(writes as unknown as Parameters<typeof this.db.batch>[0]);

    // STAFF WHAT WAS JUST DECLARED. Applying a template writes the lanes and their role
    // requirements and stopped there, so every board in production shipped fully
    // described and completely unstaffed — measured at 3 of 61 auto-gated lanes carrying
    // any assignment, and 57% of tickets inert from creation as a result. This binds an
    // agent the tenant ALREADY has to each lane's declared producer role; it never hires
    // (that stays the manager's budgeted job) and never overwrites an existing binding.
    const seeded = await seedLaneStaffingFromWorkforce(env, this.db, { tenantId, projectId, boardId });

    // Every lane's position/terminal/parking just changed (or the board is new):
    // drop the cached ordinal map the ticket-move path reads.
    await Promise.all([invalidateSwimlaneOrdinals(env, projectId), invalidateBoardLanesCache(env, tenantId, boardId)]);
    return { boardId, lanesApplied: template.lanes.length, requirementsApplied, lanesStaffed: seeded.staffed };
  }
}
