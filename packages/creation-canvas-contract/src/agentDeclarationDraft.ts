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
 * fields a person typed become the declaration's fields.
 *
 * ── WHY THE DECLARATION TYPES ARE STRUCTURAL ─────────────────────────────────────
 * The declaration is the runtime's (`AgentDeclaration` in
 * `@seanhogg/builderforce-webcontainers-core/manifest`). This package is source-only and
 * declares no install, so — like `@builderforce/app-detect`'s `manifestShape.ts` — it states
 * the subset it WRITES structurally rather than import the built runtime: importing it would
 * oblige every project that compiles this barrel to install and path-map the runtime. The
 * shapes below are assignable to the runtime's; the consumers that do install it (the api's
 * `app_manifest.add_agent` test) run what this maps through the runtime's `validateManifest`.
 *
 * Pure: no React, no I/O.
 */

/** What starts an agent run. Mirrors core `AgentTrigger`. */
export type ManifestAgentTrigger =
  | { manual: true }
  | { cron: string; timezone?: string }
  | { service: string; event: string };

/** Spend limits of one agent run. Mirrors core `AgentBudget`. */
export interface ManifestAgentBudget {
  tokens?: number;
  usd?: number;
  steps?: number;
}

/** The fields of core `AgentDeclaration` this mapping writes; assignable to it. */
export interface ManifestAgentDeclaration {
  role?: string;
  workload?: string;
  instructions?: string;
  tools?: string[];
  triggers?: ManifestAgentTrigger[];
  budget?: ManifestAgentBudget;
}

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
  budget: ManifestAgentBudget;
}

function toTrigger(trigger: AgentDraftTrigger): ManifestAgentTrigger {
  switch (trigger.kind) {
    case 'manual':
      return { manual: true };
    case 'cron':
      return { cron: trigger.cron.trim(), timezone: trigger.timezone?.trim() || AGENT_CRON_DEFAULT_TIMEZONE };
    case 'service':
      return { service: trigger.service.trim(), event: trigger.event.trim() };
  }
}

function toBudget(budget: ManifestAgentBudget): ManifestAgentBudget | undefined {
  const entries = Object.entries(budget).filter(([, value]) => value !== undefined);
  return entries.length ? (Object.fromEntries(entries) as ManifestAgentBudget) : undefined;
}

/** The manifest declaration a draft stands for. The caller keys it by `draft.id`. */
export function toAgentDeclaration(draft: AgentDraft): ManifestAgentDeclaration {
  const declaration: ManifestAgentDeclaration = { [draft.role.kind]: draft.role.key.trim(), tools: [...draft.tools] };
  const instructions = draft.instructionsPath.trim();
  if (instructions) declaration.instructions = instructions;
  if (draft.triggers.length) declaration.triggers = draft.triggers.map(toTrigger);
  const budget = toBudget(draft.budget);
  if (budget) declaration.budget = budget;
  return declaration;
}
