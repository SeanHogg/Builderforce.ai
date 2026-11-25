import { isClosedTaskStatus } from "@builderforce/agent-loop";

/**
 * The board lanes a ticket can be set to, in flow order — ONE list for the board
 * panel's columns and the Work view's "Set status" picker, which each used to keep
 * their own copy (and neither had `cancelled`, so a cancelled card fell into Backlog).
 * Mirrors the web app's task statuses; vscode-free so it can be unit-tested.
 */
export interface TaskLane {
  key: string;
  /** English source label — also the l10n key (`vscode.l10n.t(label)`). */
  label: string;
  /** A closed lane (done / cancelled): its tickets leave the open Tasks list. */
  closed: boolean;
}

const lane = (key: string, label: string): TaskLane => ({ key, label, closed: isClosedTaskStatus(key) });

export const TASK_LANES: readonly TaskLane[] = [
  lane("backlog", "Backlog"),
  lane("todo", "To do"),
  lane("ready", "Ready"),
  lane("in_progress", "In progress"),
  lane("in_review", "In review"),
  lane("blocked", "Blocked"),
  lane("done", "Done"),
  lane("cancelled", "Cancelled"),
];

export const TASK_LANE_KEYS: ReadonlySet<string> = new Set(TASK_LANES.map((l) => l.key));
