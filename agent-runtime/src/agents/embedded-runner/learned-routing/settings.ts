/**
 * Learned Model Routing (PRD 13) — the on-prem host's SETTINGS seam.
 *
 * One place that answers "may I", "where do I write", and "whose evidence do I read",
 * so no other module in this folder reads an env var or spells a URL.
 *
 * ── THE TWO GATES ────────────────────────────────────────────────────────────
 *   • `LEARNED_ROUTING_ENABLED`  — the FEATURE kill switch, DEFAULT ON. Exactly the
 *     switch the api gates on, evaluated by exactly the same shared function
 *     ({@link learnedRoutingEnabled}), so turning the feature off turns BOTH halves
 *     off and an operator does not have to learn a second name.
 *   • `BUILDERFORCE_LEARNED_ROUTING_SEED` — the READ side (re-ranking this host's own
 *     model candidates), DEFAULT OFF.
 *
 * Those defaults are not symmetric, and deliberately so. WRITE-BACK is on because a
 * terminal outcome is evidence the fleet is otherwise blind to, and reporting it
 * changes nothing about how this host behaves. READ-SIDE re-ranking is off because
 * on-prem `agents.defaults.model.primary` is an EXPLICIT operator pin — the cloud
 * router never re-ranks an explicit pin either (see `pickCloudModel`, where an
 * honoured pin returns `strict` before the learned branch is reached) — so reordering
 * it by default would silently override a choice someone made on purpose. An operator
 * who WANTS the fleet's opinion to lead opts in.
 */

import {
  learnedRoutingEnabled,
  OWN_TENANT_SCOPE_TOKEN,
  scopeToken,
  type RoutingScope,
} from "@builderforce/learned-routing";
import { readSharedEnvVar } from "../../../infra/env-file.js";
import { normalizeBaseUrl } from "../../../utils/normalize-base-url.js";

/** Env var that opts this host into learned RE-RANKING of its model candidates. */
export const SEED_FLAG_ENV = "BUILDERFORCE_LEARNED_ROUTING_SEED";

/** Env var naming the project whose routing scope this host reads/reports under. */
export const PROJECT_ID_ENV = "BUILDERFORCE_PROJECT_ID";

const DEFAULT_GATEWAY_URL = "https://api.builderforce.ai";

/** Read an env var from the process first, then the shared `~/.builderforce/.env`
 *  — the same precedence every other agent-runtime → api call uses. */
function readEnv(key: string): string | undefined {
  const fromProcess = process.env[key]?.trim();
  if (fromProcess) {
    return fromProcess;
  }
  return readSharedEnvVar(key)?.trim() || undefined;
}

/** The feature kill switch, evaluated by the SHARED predicate so this host and the
 *  api can never disagree about what "off" means. Default ON. */
export function learnedRoutingOn(): boolean {
  return learnedRoutingEnabled({ LEARNED_ROUTING_ENABLED: readEnv("LEARNED_ROUTING_ENABLED") });
}

/** Opt-in read side: re-rank this host's model candidates from the fleet's table.
 *  Default OFF (see the module header on why it is not symmetric with write-back). */
export function learnedSeedingOn(): boolean {
  if (!learnedRoutingOn()) {
    return false;
  }
  const v = (readEnv(SEED_FLAG_ENV) ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export type GatewayLink = { base: string; apiKey: string };

/**
 * The linked Builderforce workspace, or null when this host is standalone. Both the
 * read and the write need a tenant credential — an unlinked host simply has no fleet
 * to learn from or teach, which is a no-op, never an error.
 */
export function resolveGatewayLink(): GatewayLink | null {
  const apiKey = readEnv("BUILDERFORCE_API_KEY");
  if (!apiKey) {
    return null;
  }
  return { base: normalizeBaseUrl(readEnv("BUILDERFORCE_URL") ?? DEFAULT_GATEWAY_URL), apiKey };
}

/**
 * The project this host's runs belong to, when it knows one. Reported on every
 * outcome so a project-scoped ranking can form, and used to read the finest scope.
 */
export function resolveProjectId(explicit?: number): number | undefined {
  const raw = explicit ?? Number(readEnv(PROJECT_ID_ENV) ?? "");
  return Number.isInteger(raw) && raw > 0 ? raw : undefined;
}

/**
 * The scope ladder this host reads, finest-first — the SAME precedence the cloud
 * router walks (project → tenant → global). Returned as wire tokens because the
 * tenant rung is the one token a client cannot spell as an id.
 */
export function resolveScopeTokens(projectId?: number): string[] {
  const project = resolveProjectId(projectId);
  const tokens: string[] = [];
  if (project != null) {
    tokens.push(scopeToken({ kind: "project", id: project } satisfies RoutingScope));
  }
  tokens.push(OWN_TENANT_SCOPE_TOKEN);
  tokens.push(scopeToken({ kind: "global" }));
  return tokens;
}
