/**
 * KanbanTemplate ↔ `catalog_items` row (kind 'kanban_template').
 *
 * Migration 1263 folded `kanban_templates` + its lanes + their requirements into
 * one `catalog_items` row: the columns every catalogue kind shares (name, slug,
 * category, visibility, price, install count, author, published_at) stay columns,
 * and what only a kanban template has — team type, fork lineage, pricing model,
 * and the lanes with their requirements — is the row's `body`. This module is the
 * one place that layout is spelled, in both directions, and it is pure so the
 * migration's mapping is pinned by a unit test rather than by a deploy.
 */
import type { TemplateValues } from '../templates/catalogTemplateStore';
import { templateVisibility, type StoredTemplate } from '../templates/templateKinds';
import type {
  KanbanTemplate,
  LaneRequirement,
  RequirementCondition,
  RequirementGate,
  RequirementKind,
  Responsibility,
  TemplateLane,
} from './types';

/** The kanban-specific payload stored in `catalog_items.body`. */
export interface KanbanTemplateBody {
  teamType?: string | null;
  parentTemplateId?: string | null;
  pricingModel?: string | null;
  priceUnit?: string | null;
  /** The pre-1263 id, when it was not a uuid and the row was given a fresh one. */
  legacyId?: string | null;
  lanes: TemplateLane[];
}

const REQUIREMENT_GATES: readonly RequirementGate[] = ['off', 'soft', 'hard'];

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const int = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;

/**
 * A requirement as stored. `kind`, `responsibility` and `condition` are kept
 * VERBATIM, the way the pre-1263 child-row reader cast them: a value this build
 * does not know (a kind added later, a condition from a newer contract) is the
 * audit and gating engines' to interpret — `requirementApplies` already treats an
 * unknown condition as "always applies" — and dropping or nulling it here would
 * silently loosen a gate on read and lose it for good on the next write.
 * Only a requirement with no kind or no ref is dropped: it addresses nothing.
 */
function parseRequirement(raw: unknown, index: number): LaneRequirement | null {
  const r = record(raw);
  const kind = str(r.kind);
  const ref = str(r.ref);
  if (!kind || !ref) return null;
  return {
    kind: kind as RequirementKind,
    ref,
    responsibility: (str(r.responsibility) as Responsibility | null) ?? undefined,
    isRequired: r.isRequired !== false,
    description: str(r.description) ?? undefined,
    position: int(r.position, index),
    ticketType: str(r.ticketType),
    quorum: typeof r.quorum === 'number' ? Math.trunc(r.quorum) : null,
    condition: str(r.condition) as RequirementCondition | null,
  };
}

function parseLane(raw: unknown, index: number): TemplateLane | null {
  const l = record(raw);
  const key = str(l.key);
  if (!key) return null;
  const requirements = Array.isArray(l.requirements)
    ? l.requirements.map(parseRequirement).filter((r): r is LaneRequirement => r !== null)
    : [];
  return {
    key,
    name: str(l.name) ?? key,
    position: int(l.position, index),
    isTerminal: l.isTerminal === true,
    gate: l.gate === 'human' ? 'human' : 'auto',
    requirementGate: oneOf(l.requirementGate, REQUIREMENT_GATES) ?? 'soft',
    requirements: requirements.sort((a, b) => a.position - b.position),
  };
}

/** Pure: read a stored body back into its typed payload. Tolerant — a malformed
 *  lane or requirement is dropped rather than failing the whole template. */
export function parseKanbanBody(body: unknown): KanbanTemplateBody {
  const b = record(body);
  const lanes = Array.isArray(b.lanes)
    ? b.lanes.map(parseLane).filter((l): l is TemplateLane => l !== null).sort((a, x) => a.position - x.position)
    : [];
  return {
    teamType: str(b.teamType),
    parentTemplateId: str(b.parentTemplateId),
    pricingModel: str(b.pricingModel),
    priceUnit: str(b.priceUnit),
    legacyId: str(b.legacyId),
    lanes,
  };
}

/**
 * Pure: a stored row → the KanbanTemplate every kanban caller reads.
 *
 * `viewerTenantId` is the workspace asking. The author is a user id of the
 * template's OWN workspace; another workspace previewing or installing a public
 * template gets `authorId: null` rather than a stranger's user id (null = an
 * anonymous marketplace read).
 */
export function kanbanTemplateFromStored(row: StoredTemplate, viewerTenantId: number | null): KanbanTemplate {
  const body = parseKanbanBody(row.body);
  const version = Number.parseInt(row.version, 10);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.summary ?? undefined,
    category: row.category ?? 'software',
    teamType: body.teamType ?? undefined,
    builtin: false,
    parentTemplateId: body.parentTemplateId ?? null,
    authorId: viewerTenantId !== null && row.tenantId === viewerTenantId ? row.createdBy : null,
    visibility: templateVisibility(row.visibility),
    published: row.publishedAt !== null,
    priceCents: row.priceCents,
    pricingModel: body.pricingModel ?? null,
    priceUnit: body.priceUnit ?? null,
    installCount: row.installCount,
    version: Number.isFinite(version) && version > 0 ? version : 1,
    lanes: body.lanes,
  };
}

/** Pure: the body to store for a template's kanban-specific fields + lanes.
 *  Lanes and requirements get their array index as a position when they carry
 *  none, matching what the pre-1263 child-row writer persisted. */
export function kanbanBodyOf(input: {
  teamType?: string | null;
  parentTemplateId?: string | null;
  pricingModel?: string | null;
  priceUnit?: string | null;
  legacyId?: string | null;
  lanes: TemplateLane[];
}): KanbanTemplateBody {
  return {
    teamType: input.teamType ?? null,
    parentTemplateId: input.parentTemplateId ?? null,
    pricingModel: input.pricingModel ?? null,
    priceUnit: input.priceUnit ?? null,
    // Carried through edits so the 1263 old→new id record is never lost.
    ...(input.legacyId ? { legacyId: input.legacyId } : {}),
    lanes: input.lanes.map((lane, i) => ({
      key: lane.key,
      name: lane.name,
      position: lane.position ?? i,
      isTerminal: lane.isTerminal === true,
      gate: lane.gate === 'human' ? 'human' : 'auto',
      requirementGate: lane.requirementGate ?? 'soft',
      requirements: lane.requirements.map((r, j) => ({
        kind: r.kind,
        ref: r.ref,
        responsibility: r.responsibility,
        isRequired: r.isRequired !== false,
        description: r.description,
        position: r.position ?? j,
        ticketType: r.ticketType ?? null,
        quorum: r.quorum ?? null,
        condition: r.condition ?? null,
      })),
    })),
  };
}

/** The price columns a template write sets. A priced template is 'usd' — the
 *  convention `templateService.saveTemplate` already applies. */
export function kanbanPriceValues(priceCents: number | null | undefined): Pick<TemplateValues, 'priceCents' | 'currency'> {
  if (priceCents === undefined) return {};
  return { priceCents, currency: priceCents === null ? null : 'usd' };
}
