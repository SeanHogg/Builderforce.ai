import type * as vscode from "vscode";
import type { PolicyGate } from "../policy";
import { renderPlatformContextSection, type RunContextEnvelope } from "@builderforce/run-context";
import { authed } from "./transport";

/**
 * The tenant's EFFECTIVE governance gates for a run in this editor — the same
 * resolver `RuntimeService.withPolicyGates` stamps onto every cloud/on-prem dispatch
 * (`GET /api/governance/policy-gates/effective`), so a gate that holds in the cloud
 * holds here on the same compiled row. `undefined` = signed out (no tenant, so no
 * tenant policy applies). Throws when the tenant's policy could not be read — the
 * caller decides fail-closed, exactly as the server does.
 */
export async function fetchPolicyGates(
  secrets: vscode.SecretStorage,
  projectId?: number,
): Promise<PolicyGate[] | undefined> {
  const qs = new URLSearchParams();
  if (projectId != null) qs.set("project", String(projectId));
  const suffix = qs.size ? `?${qs.toString()}` : "";
  const r = await authed<{ gates?: PolicyGate[] }>(secrets, `/api/governance/policy-gates/effective${suffix}`);
  if (r === undefined) return undefined;
  return Array.isArray(r.gates) ? r.gates : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Run context — the ONE assembled context every prompt-assembly surface consumes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The platform context for the work this chat is doing — strategy (OKRs), the ticket's
 * PRD, project + agent governance, durable project memory and prior Evermind lessons —
 * assembled by the api's single `ContextSource` and reconciled through Evermind
 * cognition, then rendered by the SHARED `@builderforce/run-context` renderer.
 *
 * The IDE agent used to get NONE of this: `buildSystemMessages` carried the IDE persona,
 * the workspace map, the editor selection and the limbic block, and nothing about what
 * the project is FOR or what rules bind it — while a cloud run on the same ticket had
 * carried PRD + governance since day one. Same source now, same words.
 *
 * `scope` is the continuity key the reconciler measures the delta against (`chat:<id>`
 * for a conversation that already has a Brain chat). Best-effort: `''` when signed out,
 * project-less, or the api is unreachable — the turn simply runs without it.
 */

export async function fetchRunContextSection(
  secrets: vscode.SecretStorage,
  projectId: number,
  opts: { scope?: string; query?: string; taskId?: number } = {},
): Promise<string> {
  try {
    const qs = new URLSearchParams();
    if (opts.scope) qs.set("scope", opts.scope.slice(0, 160));
    if (opts.query?.trim()) qs.set("query", opts.query.trim().slice(0, 2000));
    if (opts.taskId != null) qs.set("taskId", String(opts.taskId));
    const r = await authed<{ envelope?: RunContextEnvelope }>(
      secrets,
      `/api/projects/${projectId}/run-context?${qs.toString()}`,
    );
    if (!r?.envelope) return "";
    return renderPlatformContextSection(r.envelope, {
      // The IDE already shows the agent its own workspace, its own tools and its own
      // capabilities; the cloud executor's versions of those blocks would contradict them.
      omit: ["workspace", "prior_changes", "tooling", "capabilities"],
    });
  } catch {
    return "";
  }
}
