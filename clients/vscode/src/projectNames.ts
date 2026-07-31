import * as vscode from "vscode";
import { listProjects } from "./bfApi";

/**
 * A shared, cached `projectId → name` map for labelling per-project rows across the
 * sidebar trees (Sessions, Inbox) when they show every project at once. One cache for
 * every consumer so switching between the trees doesn't refetch, and one place to
 * invalidate when a project is created/renamed. Best-effort: an unresolved name just
 * falls back to no label rather than erroring.
 */
let cache: { ts: number; byId: Map<number, string> } | undefined;
const TTL = 60_000;

/** The `projectId → name` map, resolved once per TTL and shared across trees. */
export async function getProjectNames(secrets: vscode.SecretStorage): Promise<Map<number, string>> {
  if (cache && Date.now() - cache.ts < TTL) return cache.byId;
  const byId = new Map<number, string>();
  try {
    for (const p of await listProjects(secrets)) byId.set(p.id, p.name);
  } catch {
    /* names are best-effort — a row just falls back to no project label */
  }
  cache = { ts: Date.now(), byId };
  return byId;
}

/**
 * The label for a row's project when a list spans every project: the project name,
 * or a localized "No project" for rows with no project association. Returns undefined
 * when the id is set but its name hasn't resolved (the row then shows no label).
 */
export function projectLabel(byId: Map<number, string>, projectId: number | null | undefined): string | undefined {
  if (projectId == null) return vscode.l10n.t("No project");
  return byId.get(projectId);
}

/** Drop the cache so the next label lookup refetches (after create/rename project). */
export function invalidateProjectNames(): void {
  cache = undefined;
}
