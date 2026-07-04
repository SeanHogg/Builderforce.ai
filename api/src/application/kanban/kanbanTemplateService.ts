/**
 * Kanban template service — the spine of the Agentic Workforce Kanban.
 *
 * Merges built-in templates (code) with tenant-authored / forked / installed
 * templates (kanban_templates + lanes + requirements). Applying a template
 * materialises its lanes onto a project's board swimlanes and its per-lane
 * requirements onto swimlane_requirements, so the live board is self-describing for
 * the audit + gating engines. Also powers the marketplace (publish / list public /
 * install a public template into your tenant).
 *
 * Cached read-through, invalidated on every write.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  boards,
  kanbanTemplateLaneRequirements,
  kanbanTemplateLanes,
  kanbanTemplates,
  projects,
  swimlaneRequirements,
  swimlanes,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { findOrCreateBoard } from '../swimlane/findOrCreateBoard';
import { BUILTIN_TEMPLATES, getBuiltinTemplate, isBuiltinTemplateId } from './templateCatalog';
import type { KanbanTemplate, TemplateLane, TemplateVisibility } from './types';

const listKey = (tenantId: number) => `kanban:templates:${tenantId}`;
const publicKey = () => `kanban:templates:public`;
const oneKey = (tenantId: number, id: string) => `kanban:template:${tenantId}:${id}`;

function slugify(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 110) || 'template';
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

  /** Load a tenant template's full shape (lanes + requirements) from the DB. */
  private async loadDbTemplate(tenantId: number, id: string): Promise<KanbanTemplate | null> {
    const [row] = await this.db
      .select()
      .from(kanbanTemplates)
      .where(and(eq(kanbanTemplates.tenantId, tenantId), eq(kanbanTemplates.id, id)))
      .limit(1);
    if (!row) return null;
    return this.assembleDbTemplate(row);
  }

  private async assembleDbTemplate(row: typeof kanbanTemplates.$inferSelect): Promise<KanbanTemplate> {
    const laneRows = await this.db
      .select()
      .from(kanbanTemplateLanes)
      .where(eq(kanbanTemplateLanes.templateId, row.id))
      .orderBy(asc(kanbanTemplateLanes.position));
    const laneIds = laneRows.map((l) => l.id);
    const reqRows = laneIds.length
      ? await this.db
          .select()
          .from(kanbanTemplateLaneRequirements)
          .where(inArray(kanbanTemplateLaneRequirements.laneId, laneIds))
          .orderBy(asc(kanbanTemplateLaneRequirements.position))
      : [];
    const lanes: TemplateLane[] = laneRows.map((l) => ({
      key: l.key, name: l.name, position: l.position, isTerminal: l.isTerminal,
      gate: (l.gate as 'auto' | 'human') ?? 'auto',
      requirementGate: (l.requirementGate as TemplateLane['requirementGate']) ?? 'soft',
      requirements: reqRows
        .filter((r) => r.laneId === l.id)
        .map((r) => ({
          kind: r.kind as TemplateLane['requirements'][number]['kind'],
          ref: r.ref,
          responsibility: (r.responsibility as TemplateLane['requirements'][number]['responsibility']) ?? undefined,
          isRequired: r.isRequired,
          description: r.description ?? undefined,
          position: r.position,
        })),
    }));
    return {
      id: row.id, slug: row.slug, name: row.name, description: row.description ?? undefined,
      category: row.category, teamType: row.teamType ?? undefined, builtin: false,
      parentTemplateId: row.parentTemplateId, authorId: row.authorId,
      visibility: row.visibility as TemplateVisibility, published: row.published,
      priceCents: row.priceCents, pricingModel: row.pricingModel, priceUnit: row.priceUnit,
      installCount: row.installCount, version: row.version, lanes,
    };
  }

  /** Built-ins + this tenant's templates, as summaries. */
  async list(env: Env, tenantId: number): Promise<TemplateSummary[]> {
    const custom = await getOrSetCached(env, listKey(tenantId), async () => {
      const rows = await this.db
        .select()
        .from(kanbanTemplates)
        .where(eq(kanbanTemplates.tenantId, tenantId))
        .orderBy(desc(kanbanTemplates.updatedAt));
      const full = await Promise.all(rows.map((r) => this.assembleDbTemplate(r)));
      return full.map(summarize);
    });
    return [...BUILTIN_TEMPLATES.map(summarize), ...custom];
  }

  /** Public marketplace listings (other tenants' published templates + built-ins). */
  async listPublic(env: Env): Promise<TemplateSummary[]> {
    const published = await getOrSetCached(env, publicKey(), async () => {
      const rows = await this.db
        .select()
        .from(kanbanTemplates)
        .where(and(eq(kanbanTemplates.published, true), eq(kanbanTemplates.visibility, 'public')))
        .orderBy(desc(kanbanTemplates.installCount));
      const full = await Promise.all(rows.map((r) => this.assembleDbTemplate(r)));
      return full.map(summarize);
    });
    return [...BUILTIN_TEMPLATES.map(summarize), ...published];
  }

  /** Full template (built-in or tenant-owned or a public one being previewed). */
  async get(env: Env, tenantId: number, id: string): Promise<KanbanTemplate | null> {
    if (isBuiltinTemplateId(id)) return getBuiltinTemplate(id) ?? null;
    const own = await getOrSetCached(env, oneKey(tenantId, id), () => this.loadDbTemplate(tenantId, id));
    if (own) return own;
    // Fall back to a public template from any tenant (for marketplace preview / install).
    const [pub] = await this.db
      .select()
      .from(kanbanTemplates)
      .where(and(eq(kanbanTemplates.id, id), eq(kanbanTemplates.published, true), eq(kanbanTemplates.visibility, 'public')))
      .limit(1);
    return pub ? this.assembleDbTemplate(pub) : null;
  }

  /** Persist a template's lanes + requirements (replace-children write). */
  private async writeLanes(templateId: string, lanes: TemplateLane[]): Promise<void> {
    // Remove existing children (requirements cascade from lanes) then re-insert.
    const existing = await this.db
      .select({ id: kanbanTemplateLanes.id })
      .from(kanbanTemplateLanes)
      .where(eq(kanbanTemplateLanes.templateId, templateId));
    if (existing.length) {
      await this.db.delete(kanbanTemplateLanes).where(eq(kanbanTemplateLanes.templateId, templateId));
    }
    const now = new Date();
    for (const [i, lane] of lanes.entries()) {
      const laneId = crypto.randomUUID();
      await this.db.insert(kanbanTemplateLanes).values({
        id: laneId, templateId, key: lane.key, name: lane.name,
        position: lane.position ?? i, isTerminal: lane.isTerminal, gate: lane.gate,
        requirementGate: lane.requirementGate, createdAt: now,
      });
      if (lane.requirements.length) {
        await this.db.insert(kanbanTemplateLaneRequirements).values(
          lane.requirements.map((r, j) => ({
            id: crypto.randomUUID(), laneId, kind: r.kind, ref: r.ref,
            responsibility: r.responsibility ?? null, isRequired: r.isRequired,
            description: r.description ?? null, position: r.position ?? j, createdAt: now,
          })),
        );
      }
    }
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
    lanes = lanes ?? [];

    const id = crypto.randomUUID();
    const slug = slugify(input.slug || name) + '-' + id.slice(0, 6);
    const now = new Date();
    await this.db.insert(kanbanTemplates).values({
      id, tenantId, slug, name,
      description: input.description ?? null,
      category: input.category ?? 'software',
      teamType: input.teamType ?? null,
      parentTemplateId,
      authorId,
      published: false, visibility: 'private',
      priceCents: input.priceCents ?? null, pricingModel: input.pricingModel ?? null, priceUnit: input.priceUnit ?? null,
      installCount: 0, version: 1, createdAt: now, updatedAt: now,
    });
    await this.writeLanes(id, lanes);
    await this.invalidate(env, tenantId, id);
    return (await this.get(env, tenantId, id))!;
  }

  async update(
    env: Env,
    tenantId: number,
    id: string,
    input: Partial<KanbanTemplate> & { lanes?: TemplateLane[] },
  ): Promise<KanbanTemplate> {
    if (isBuiltinTemplateId(id)) throw new Error('built-in templates cannot be edited — fork it first');
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name) set.name = input.name.trim();
    if (input.description !== undefined) set.description = input.description || null;
    if (input.category) set.category = input.category;
    if (input.teamType !== undefined) set.teamType = input.teamType || null;
    if (input.priceCents !== undefined) set.priceCents = input.priceCents;
    if (input.pricingModel !== undefined) set.pricingModel = input.pricingModel || null;
    if (input.priceUnit !== undefined) set.priceUnit = input.priceUnit || null;
    await this.db.update(kanbanTemplates).set(set).where(and(eq(kanbanTemplates.tenantId, tenantId), eq(kanbanTemplates.id, id)));
    if (input.lanes) await this.writeLanes(id, input.lanes);
    await this.invalidate(env, tenantId, id);
    return (await this.get(env, tenantId, id))!;
  }

  async remove(env: Env, tenantId: number, id: string): Promise<void> {
    if (isBuiltinTemplateId(id)) throw new Error('built-in templates cannot be deleted');
    await this.db.delete(kanbanTemplates).where(and(eq(kanbanTemplates.tenantId, tenantId), eq(kanbanTemplates.id, id)));
    await this.invalidate(env, tenantId, id);
  }

  /** Publish / unpublish a tenant template to the marketplace. */
  async setPublication(
    env: Env,
    tenantId: number,
    id: string,
    opts: { published: boolean; visibility?: TemplateVisibility; priceCents?: number | null; pricingModel?: string | null; priceUnit?: string | null },
  ): Promise<void> {
    if (isBuiltinTemplateId(id)) throw new Error('built-in templates are already public');
    await this.db
      .update(kanbanTemplates)
      .set({
        published: opts.published,
        visibility: opts.visibility ?? (opts.published ? 'public' : 'private'),
        ...(opts.priceCents !== undefined ? { priceCents: opts.priceCents } : {}),
        ...(opts.pricingModel !== undefined ? { pricingModel: opts.pricingModel } : {}),
        ...(opts.priceUnit !== undefined ? { priceUnit: opts.priceUnit } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(kanbanTemplates.tenantId, tenantId), eq(kanbanTemplates.id, id)));
    await this.invalidate(env, tenantId, id);
    await invalidateCached(env, publicKey());
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
    // Bump the source's install count (skip built-ins, which live in code).
    if (!isBuiltinTemplateId(sourceId)) {
      await this.db
        .update(kanbanTemplates)
        .set({ installCount: (src.installCount ?? 0) + 1 })
        .where(eq(kanbanTemplates.id, sourceId));
      await invalidateCached(env, publicKey());
    }
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
  ): Promise<{ boardId: string; lanesApplied: number; requirementsApplied: number }> {
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
      .where(eq(swimlanes.boardId, boardId));
    const laneByKey = new Map(existingLanes.map((l) => [l.key, l.id]));

    let requirementsApplied = 0;
    for (const lane of template.lanes) {
      let laneId = laneByKey.get(lane.key);
      if (laneId) {
        await this.db
          .update(swimlanes)
          .set({
            name: lane.name, position: lane.position, isTerminal: lane.isTerminal,
            gate: lane.gate, requirementGate: lane.requirementGate, updatedAt: now,
          })
          .where(eq(swimlanes.id, laneId));
      } else {
        laneId = crypto.randomUUID();
        await this.db.insert(swimlanes).values({
          id: laneId, tenantId, segmentId: realBoard.segmentId ?? null, boardId,
          key: lane.key, name: lane.name, position: lane.position, isTerminal: lane.isTerminal,
          gate: lane.gate, requirementGate: lane.requirementGate,
          executionMode: 'sequential', failurePolicy: 'needs_attention',
          createdAt: now, updatedAt: now,
        });
        laneByKey.set(lane.key, laneId);
      }
      // Replace this lane's live requirements with the template's.
      await this.db.delete(swimlaneRequirements).where(eq(swimlaneRequirements.swimlaneId, laneId));
      if (lane.requirements.length) {
        await this.db.insert(swimlaneRequirements).values(
          lane.requirements.map((r) => ({
            id: crypto.randomUUID(), tenantId, swimlaneId: laneId!,
            kind: r.kind, ref: r.ref, responsibility: r.responsibility ?? null,
            isRequired: r.isRequired, description: r.description ?? null, position: r.position, createdAt: now,
          })),
        );
        requirementsApplied += lane.requirements.length;
      }
    }

    await this.db.update(boards).set({ templateId, updatedAt: now }).where(eq(boards.id, boardId));
    await this.db.update(projects).set({ kanbanTemplateId: templateId, updatedAt: now }).where(eq(projects.id, projectId));

    return { boardId, lanesApplied: template.lanes.length, requirementsApplied };
  }

  private async invalidate(env: Env, tenantId: number, id: string): Promise<void> {
    await invalidateCached(env, listKey(tenantId));
    await invalidateCached(env, oneKey(tenantId, id));
  }
}
