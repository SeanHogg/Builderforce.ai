/**
 * AN AGENT DEFINED WITHOUT CODE — the draft a person fills in, and the ONE mapping from
 * that draft to the manifest's `agents.<id>` declaration (W12).
 *
 * ── WHY THE MAPPING LIVES HERE ───────────────────────────────────────────────────
 * The canvas form produces the draft and the `app_manifest.add_agent` tool writes what it
 * maps to. A second mapping (one in the form, one beside the tool) is how "cron without a
 * timezone" would come to mean UTC on one side and the reader's local zone on the other.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────────
 * It never validates. Roles that look like model ids, tools above the environment's
 * ceiling, a cron that does not parse — every one of those is the runtime's
 * `validateManifest` to report, with its own typed issue. This module only says how the
 * fields a person typed become the declaration's fields. The declaration type is the
 * runtime's own (`@seanhogg/builderforce-webcontainers-core/manifest`), never a copy.
 *
 * Pure: no React, no I/O.
 */
import type {
  AgentBudget,
  AgentDeclaration,
  AgentTrigger,
} from '@seanhogg/builderforce-webcontainers-core/manifest';

/** The zone a cron trigger runs in when the draft names none. */
export const AGENT_CRON_DEFAULT_TIMEZONE = 'UTC';

/** A declaration names a ROLE or a WORKLOAD (exactly one) — never a model. */
export type AgentDraftRoleKind = 'role' | 'workload';

export interface AgentDraftRole {
  kind: AgentDraftRoleKind;
  /** The vocabulary key the host's model router resolves, e.g. `developer`. */
  key: string;
}

/** What starts a run, as the form holds it: tagged, so a field can switch shape. */
export type AgentDraftTrigger =
  | { kind: 'manual' }
  | { kind: 'cron'; cron: string; timezone?: string }
  | { kind: 'service'; service: string; event: string };

export type AgentDraftTriggerKind = AgentDraftTrigger['kind'];

export const AGENT_DRAFT_TRIGGER_KINDS: readonly AgentDraftTriggerKind[] = ['manual', 'cron', 'service'];

/** The draft of one agent: its manifest key and the fields a person fills in. */
export interface AgentDraft {
  /** The key under `agents` in the manifest. */
  id: string;
  role: AgentDraftRole;
  /** Project-relative path to the instructions file; empty for none. */
  instructionsPath: string;
  /** Tool catalog keys. An empty list is a valid declaration: an agent with no tools. */
  tools: readonly string[];
  /** Empty means the runtime's default (`[{ manual: true }]`). */
  triggers: readonly AgentDraftTrigger[];
  budget: AgentBudget;
}

function toTrigger(trigger: AgentDraftTrigger): AgentTrigger {
  switch (trigger.kind) {
    case 'manual':
      return { manual: true };
    case 'cron':
      return { cron: trigger.cron.trim(), timezone: trigger.timezone?.trim() || AGENT_CRON_DEFAULT_TIMEZONE };
    case 'service':
      return { service: trigger.service.trim(), event: trigger.event.trim() };
  }
}

function toBudget(budget: AgentBudget): AgentBudget | undefined {
  const entries = Object.entries(budget).filter(([, value]) => value !== undefined);
  return entries.length ? (Object.fromEntries(entries) as AgentBudget) : undefined;
}

/** The manifest declaration a draft stands for. The caller keys it by `draft.id`. */
export function toAgentDeclaration(draft: AgentDraft): AgentDeclaration {
  const declaration: AgentDeclaration = { [draft.role.kind]: draft.role.key.trim(), tools: [...draft.tools] };
  const instructions = draft.instructionsPath.trim();
  if (instructions) declaration.instructions = instructions;
  if (draft.triggers.length) declaration.triggers = draft.triggers.map(toTrigger);
  const budget = toBudget(draft.budget);
  if (budget) declaration.budget = budget;
  return declaration;
}
