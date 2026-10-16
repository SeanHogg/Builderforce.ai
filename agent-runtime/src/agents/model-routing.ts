/**
 * Model CHOICE for on-prem calls that know what they are FOR — a role-typed subagent
 * and a relay-dispatched task — through the shared router (`candidate-ranking.ts` over
 * `@builderforce/model-router`) and this host's catalog (`model-catalog-view.ts`).
 *
 * The candidates are ALWAYS this host's configured chain (`resolveFallbackCandidates`:
 * the primary, then `agents.defaults.model.fallbacks`) — the router decides which of
 * them leads, never which models exist. An explicit model (a caller override, a role or
 * agent pin in config) is an operator decision and is returned untouched.
 *
 * Never throws: any failure resolves to what the caller would have used without routing.
 */

import type { ModelRole } from "@builderforce/agent-tools";
import type { CatalogView } from "@builderforce/model-catalog";
import { type BuilderForceAgentsConfig, loadConfig } from "../config/config.js";
import { logDebug } from "../logger.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./defaults.js";
import { candidateKey } from "./embedded-runner/learned-routing/candidate-keys.js";
import { seedLearnedModel } from "./embedded-runner/learned-routing/index.js";
import { loadOnPremCatalogView } from "./model-catalog-view.js";
import { resolveFallbackCandidates } from "./model-fallback.js";
import {
  buildModelAliasIndex,
  normalizeModelSelection,
  normalizeProviderId,
  resolveModelRefFromString,
  resolveSubagentConfiguredModelSelection,
  resolveSubagentSpawnModelSelection,
} from "./model-selection.js";

/**
 * The role a relay-dispatched ticket runs as. A dispatched ticket is executed end to end
 * by the coding agent (it edits, commits and pushes the repo), which is the `code` call
 * purpose — the same default `delegationRole` gives an undeclared delegated slice.
 */
export const RELAY_TASK_ROLE: ModelRole = "code";

/**
 * Order this host's chain, led by `lead`, for a role; return the `provider/model` that
 * leads. Learned evidence joins in when the operator opted into learned seeding.
 */
export async function resolveRoleRoutedModel(params: {
  cfg: BuilderForceAgentsConfig;
  /** The model that would run without routing, `provider/model` or an alias. */
  lead: string;
  role: ModelRole;
  prompt?: string | null;
  view?: CatalogView;
}): Promise<string> {
  try {
    const resolved = resolveModelRefFromString({
      raw: params.lead,
      defaultProvider: DEFAULT_PROVIDER,
      aliasIndex: buildModelAliasIndex({ cfg: params.cfg, defaultProvider: DEFAULT_PROVIDER }),
    });
    if (!resolved) {
      return params.lead;
    }
    const candidates = resolveFallbackCandidates({
      cfg: params.cfg,
      provider: resolved.ref.provider,
      model: resolved.ref.model,
    });
    const seed = await seedLearnedModel({
      candidates,
      ...(params.prompt != null ? { prompt: params.prompt } : {}),
      routing: { role: params.role, view: params.view ?? loadOnPremCatalogView({ cfg: params.cfg }) },
    });
    const winner = seed.ranked[0];
    return winner ? candidateKey(winner) : params.lead;
  } catch (err) {
    logDebug(`[model-routing] role routing failed, keeping ${params.lead}: ${String(err)}`);
    return params.lead;
  }
}

/**
 * The model a subagent spawns on. An explicit choice — the spawn's own `model`, a role
 * or agent pin, `subagents.model` — wins as-is. Otherwise, when the spawn declared a
 * role, the router picks the lead of the configured chain for it; with no role the
 * runtime default stands.
 */
export async function resolveSubagentSpawnModel(params: {
  cfg: BuilderForceAgentsConfig;
  agentId: string;
  modelOverride?: unknown;
  role?: ModelRole;
  task?: string;
}): Promise<string> {
  const selection = resolveSubagentSpawnModelSelection(params);
  const explicit =
    normalizeModelSelection(params.modelOverride) ??
    resolveSubagentConfiguredModelSelection({ cfg: params.cfg, agentId: params.agentId });
  if (explicit || !params.role) {
    return selection;
  }
  return resolveRoleRoutedModel({
    cfg: params.cfg,
    lead: selection,
    role: params.role,
    prompt: params.task,
  });
}

/**
 * The model a relay-dispatched task runs on when the dispatch pinned none. The task runs
 * the Claude Agent SDK loop against the Builderforce gateway, so only candidates the
 * gateway itself serves (the `builderforcellm` provider) are eligible, and its `auto`
 * pool id is not a choice — it is the absence of one. Returns the gateway model id, or
 * `undefined` to leave the choice to the engine/gateway exactly as before.
 */
export async function resolveRelayTaskModel(params: {
  prompt: string;
  cfg?: BuilderForceAgentsConfig;
}): Promise<string | undefined> {
  try {
    const cfg = params.cfg ?? loadConfig();
    const gateway = normalizeProviderId(DEFAULT_PROVIDER);
    const candidates = resolveFallbackCandidates({ cfg, provider: "", model: "" }).filter(
      (c) => normalizeProviderId(c.provider) === gateway && c.model !== DEFAULT_MODEL,
    );
    if (candidates.length === 0) {
      return undefined;
    }
    const seed = await seedLearnedModel({
      candidates,
      prompt: params.prompt,
      routing: { role: RELAY_TASK_ROLE, view: loadOnPremCatalogView({ cfg }) },
    });
    return seed.ranked[0]?.model;
  } catch (err) {
    logDebug(`[model-routing] relay task routing failed, engine default stands: ${String(err)}`);
    return undefined;
  }
}
