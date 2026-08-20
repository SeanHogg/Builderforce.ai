import * as vscode from "vscode";
import { readRecentSessionNotes } from "./sessionNotes";

/** Single source of truth for the current workspace grounding summary, shared by the
 *  chat panels and the native chat participant (so none holds its own copy). */
let groundingSummary: string | undefined;
const emitter = new vscode.EventEmitter<void>();
export const onGroundingChange = emitter.event;

export function setGroundingSummary(summary: string | undefined): void {
  groundingSummary = summary;
  emitter.fire();
}

export function getGroundingSummary(): string | undefined {
  return groundingSummary;
}

/**
 * The grounding a turn should actually see: the workspace MAP plus what recent runs in
 * this workspace DID (`.builderforce/memory/<date>.md`).
 *
 * The map alone is a static picture of the repo's shape, refreshed only on rescan. The
 * notes are what makes the knowledge loop a loop — a run grounds on the decisions and
 * files of the runs before it, so the surface gets better the more it is used, which is
 * the behaviour the on-prem runtime has always had and the editor did not.
 *
 * Async and best-effort: an unreadable (or absent) memory tree degrades to the map alone,
 * never to a failed turn.
 */
export async function getGroundingWithHistory(root: string | undefined): Promise<string | undefined> {
  const map = groundingSummary;
  if (!root) return map;
  const notes = await readRecentSessionNotes(root);
  if (!notes) return map;
  const history = `## Recent activity in this workspace
${notes}`;
  return map ? `${map}

${history}` : history;
}
