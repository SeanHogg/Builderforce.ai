/**
 * Agentic Workforce Kanban — shared domain types.
 *
 * One primitive, the KanbanTemplate, binds {responsible roles, required checks,
 * gate} to each lane. From it we derive the recommended roster (union of roles),
 * per-ticket audits (were the required roles/diagnostics performed), and swimlane
 * round-trip gating (a required reviewer must sign off before advance). Built-in
 * roles + templates are TS constants (see roleCatalog.ts / templateCatalog.ts);
 * tenant-authored rows live in the DB and are merged on read.
 */

export type Discipline =
  | 'engineering' | 'product' | 'design' | 'qa' | 'devops' | 'data' | 'security' | 'other';

export type Responsibility = 'owner' | 'reviewer' | 'contributor';
export type RequirementKind = 'role' | 'diagnostic' | 'review';
/** How strictly a lane's required checks gate entry. */
export type RequirementGate = 'off' | 'soft' | 'hard';
export type LaneGate = 'auto' | 'human';
export type TemplateVisibility = 'private' | 'tenant' | 'public';

export interface JobRole {
  key: string;
  name: string;
  description?: string;
  discipline: Discipline;
  color?: string;
  icon?: string;
  /** True for a canonical built-in role (served from code); false for tenant custom. */
  builtin: boolean;
  position: number;
}

export interface LaneRequirement {
  kind: RequirementKind;
  /** role key (role/review) OR diagnostic tool id (diagnostic). */
  ref: string;
  responsibility?: Responsibility;
  isRequired: boolean;
  description?: string;
  position: number;
}

export interface TemplateLane {
  key: string;
  name: string;
  position: number;
  isTerminal: boolean;
  gate: LaneGate;
  requirementGate: RequirementGate;
  requirements: LaneRequirement[];
}

export interface KanbanTemplate {
  /** Built-in slug (e.g. 'standard-swe') or a kanban_templates.id (uuid). */
  id: string;
  slug: string;
  name: string;
  description?: string;
  category: string;
  teamType?: string;
  builtin: boolean;
  parentTemplateId?: string | null;
  authorId?: string | null;
  visibility: TemplateVisibility;
  published: boolean;
  priceCents?: number | null;
  pricingModel?: string | null;
  priceUnit?: string | null;
  installCount: number;
  version: number;
  lanes: TemplateLane[];
}

/** The union of distinct role keys a template references across all its lanes,
 *  with whether the role is required somewhere and the lanes it appears in. */
export interface TemplateRosterRole {
  roleKey: string;
  required: boolean;
  lanes: string[];
}

export function templateRosterRoles(t: Pick<KanbanTemplate, 'lanes'>): TemplateRosterRole[] {
  const byRole = new Map<string, TemplateRosterRole>();
  for (const lane of t.lanes) {
    for (const req of lane.requirements) {
      if (req.kind !== 'role' && req.kind !== 'review') continue;
      const existing = byRole.get(req.ref) ?? { roleKey: req.ref, required: false, lanes: [] };
      existing.required = existing.required || req.isRequired;
      if (!existing.lanes.includes(lane.key)) existing.lanes.push(lane.key);
      byRole.set(req.ref, existing);
    }
  }
  return [...byRole.values()];
}
