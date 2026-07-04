/**
 * Canonical built-in kanban templates — the standard software-engineering board
 * and a couple of alternates, served as read-only built-ins (mirrors the deck
 * tenant_id=0 built-ins). Tenants fork these into editable DB rows.
 *
 * Lane keys align with the existing task statuses (backlog…done) so applying a
 * built-in template keeps the current board columns working while attaching role
 * ownership + per-lane requirements. Custom (DB) templates may introduce their own
 * lane keys; those are materialised as extra swimlanes used by audit + gating.
 */
import type { KanbanTemplate, TemplateLane } from './types';

function lane(l: Partial<TemplateLane> & Pick<TemplateLane, 'key' | 'name' | 'position'>): TemplateLane {
  return {
    isTerminal: false,
    gate: 'auto',
    requirementGate: 'soft',
    requirements: [],
    ...l,
  };
}

/**
 * The flagship: best-practice software engineering kanban. Encodes the vision's
 * example — a ticket cannot reach code review / Done without the Architect having
 * reviewed the implementation against the PRD, and QA having verified it.
 */
const STANDARD_SWE: KanbanTemplate = {
  id: 'standard-swe',
  slug: 'standard-swe',
  name: 'Standard Software Engineering',
  description:
    'Best-practice SWE kanban: BA grooms, Architect reviews the approach, Developer builds, ' +
    'Code Review + Architect sign off the implementation, QA verifies acceptance criteria before Done.',
  category: 'software',
  teamType: 'Software team',
  builtin: true,
  visibility: 'public',
  published: true,
  installCount: 0,
  version: 1,
  lanes: [
    lane({ key: 'backlog', name: 'Backlog', position: 0, requirementGate: 'off', requirements: [
      { kind: 'role', ref: 'business-analyst', responsibility: 'owner', isRequired: false, position: 0,
        description: 'BA captures the need.' },
    ] }),
    lane({ key: 'todo', name: 'To Do', position: 1, requirementGate: 'off', requirements: [
      { kind: 'role', ref: 'product-manager', responsibility: 'owner', isRequired: false, position: 0,
        description: 'PM sets scope, priority and acceptance criteria.' },
    ] }),
    lane({ key: 'ready', name: 'Ready for Dev', position: 2, requirementGate: 'soft', requirements: [
      { kind: 'role', ref: 'developer', responsibility: 'owner', isRequired: false, position: 0 },
      { kind: 'review', ref: 'architect', responsibility: 'reviewer', isRequired: true, position: 1,
        description: 'Architect reviews the PRD and approach before development starts.' },
    ] }),
    lane({ key: 'in_progress', name: 'In Progress', position: 3, requirementGate: 'off', requirements: [
      { kind: 'role', ref: 'developer', responsibility: 'owner', isRequired: true, position: 0 },
    ] }),
    lane({ key: 'in_review', name: 'Review & Test', position: 4, gate: 'human', requirementGate: 'soft', requirements: [
      { kind: 'review', ref: 'code-reviewer', responsibility: 'reviewer', isRequired: true, position: 0,
        description: 'Code review of the diff for correctness and standards.' },
      { kind: 'review', ref: 'architect', responsibility: 'reviewer', isRequired: true, position: 1,
        description: 'Architect reviews the implementation against the PRD.' },
      { kind: 'review', ref: 'qa-tester', responsibility: 'reviewer', isRequired: true, position: 2,
        description: 'QA verifies the acceptance criteria.' },
    ] }),
    lane({ key: 'blocked', name: 'Blocked', position: 5, requirementGate: 'off', requirements: [] }),
    lane({ key: 'done', name: 'Done', position: 6, isTerminal: true, requirementGate: 'soft', requirements: [
      { kind: 'review', ref: 'architect', responsibility: 'reviewer', isRequired: true, position: 0,
        description: 'Definition of Done: architecture reviewed.' },
      { kind: 'review', ref: 'code-reviewer', responsibility: 'reviewer', isRequired: true, position: 1,
        description: 'Definition of Done: code reviewed.' },
      { kind: 'review', ref: 'qa-tester', responsibility: 'reviewer', isRequired: true, position: 2,
        description: 'Definition of Done: QA verified.' },
    ] }),
  ],
};

/** Lean startup: fast, minimal gating — build → ship, one reviewer. */
const LEAN_STARTUP: KanbanTemplate = {
  id: 'lean-startup',
  slug: 'lean-startup',
  name: 'Lean Startup',
  description: 'Move fast: a single builder-reviewer loop with light gating. Ideal for a tiny founding team.',
  category: 'software',
  teamType: 'Founding team',
  builtin: true,
  visibility: 'public',
  published: true,
  installCount: 0,
  version: 1,
  lanes: [
    lane({ key: 'backlog', name: 'Ideas', position: 0, requirementGate: 'off' }),
    lane({ key: 'todo', name: 'Next Up', position: 1, requirementGate: 'off', requirements: [
      { kind: 'role', ref: 'product-manager', responsibility: 'owner', isRequired: false, position: 0 },
    ] }),
    lane({ key: 'in_progress', name: 'Building', position: 2, requirementGate: 'off', requirements: [
      { kind: 'role', ref: 'developer', responsibility: 'owner', isRequired: true, position: 0 },
    ] }),
    lane({ key: 'in_review', name: 'Review', position: 3, gate: 'human', requirementGate: 'soft', requirements: [
      { kind: 'review', ref: 'code-reviewer', responsibility: 'reviewer', isRequired: true, position: 0 },
    ] }),
    lane({ key: 'done', name: 'Shipped', position: 4, isTerminal: true, requirementGate: 'off' }),
  ],
};

/** Bug triage: severity-first flow with security + QA gates. */
const BUG_TRIAGE: KanbanTemplate = {
  id: 'bug-triage',
  slug: 'bug-triage',
  name: 'Bug Triage & Fix',
  description: 'Incident/bug flow: triage → reproduce → fix → verify, with security and QA sign-off.',
  category: 'software',
  teamType: 'Support / SRE',
  builtin: true,
  visibility: 'public',
  published: true,
  installCount: 0,
  version: 1,
  lanes: [
    lane({ key: 'backlog', name: 'Reported', position: 0, requirementGate: 'off', requirements: [
      { kind: 'role', ref: 'qa-tester', responsibility: 'owner', isRequired: false, position: 0 },
    ] }),
    lane({ key: 'ready', name: 'Triaged', position: 1, requirementGate: 'soft', requirements: [
      { kind: 'review', ref: 'qa-tester', responsibility: 'reviewer', isRequired: true, position: 0,
        description: 'Reproduced and severity assigned.' },
    ] }),
    lane({ key: 'in_progress', name: 'Fixing', position: 2, requirementGate: 'off', requirements: [
      { kind: 'role', ref: 'developer', responsibility: 'owner', isRequired: true, position: 0 },
    ] }),
    lane({ key: 'in_review', name: 'Verify', position: 3, gate: 'human', requirementGate: 'soft', requirements: [
      { kind: 'review', ref: 'code-reviewer', responsibility: 'reviewer', isRequired: true, position: 0 },
      { kind: 'review', ref: 'security', responsibility: 'reviewer', isRequired: false, position: 1,
        description: 'Security review for a security-tagged fix.' },
      { kind: 'review', ref: 'qa-tester', responsibility: 'reviewer', isRequired: true, position: 2 },
    ] }),
    lane({ key: 'done', name: 'Resolved', position: 4, isTerminal: true, requirementGate: 'soft', requirements: [
      { kind: 'review', ref: 'qa-tester', responsibility: 'reviewer', isRequired: true, position: 0 },
    ] }),
  ],
};

export const BUILTIN_TEMPLATES: KanbanTemplate[] = [STANDARD_SWE, LEAN_STARTUP, BUG_TRIAGE];

/** The template applied to a brand-new project's board by default. */
export const DEFAULT_TEMPLATE_ID = 'standard-swe';

const BY_ID = new Map(BUILTIN_TEMPLATES.map((t) => [t.id, t]));

export function isBuiltinTemplateId(id: string): boolean {
  return BY_ID.has(id);
}

export function getBuiltinTemplate(id: string): KanbanTemplate | undefined {
  return BY_ID.get(id);
}
