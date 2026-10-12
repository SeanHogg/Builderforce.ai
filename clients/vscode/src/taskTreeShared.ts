import * as vscode from "vscode";
import { isCancelledTaskStatus, isClosedTask } from "@builderforce/agent-loop";
import type { BfTask } from "./bfApi";
import { TASK_LANES } from "./taskLanes";

/**
 * Row vocabulary shared by the Work view's open Tasks section and its Closed section:
 * status/priority ordering, human labels, the row label and the status icon. One
 * place, so a ticket reads the same whichever section it sits in.
 */

// A ticket is "stale" (needs attention) once it hasn't moved in this many days.
const STALE_DAYS = 14;
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

/**
 * "Needs attention" predicate — shared by the filter and the row badge so both
 * agree on what's at risk: blocked, past its due date, or gone stale (not touched
 * in {@link STALE_DAYS} days). Closed work never needs attention.
 */
export function taskNeedsAttention(task: BfTask, nowMs: number): boolean {
  if (isClosedTask(task)) return false;
  if ((task.status ?? "").toLowerCase() === "blocked") return true;
  if (task.dueDate) {
    const due = Date.parse(task.dueDate);
    if (Number.isFinite(due) && due < nowMs) return true;
  }
  if (task.updatedAt) {
    const touched = Date.parse(task.updatedAt);
    if (Number.isFinite(touched) && nowMs - touched > STALE_MS) return true;
  }
  return false;
}

// Canonical ordering for status/priority sorts + grouping (unknown values sort last,
// alphabetically). Shared by the sort comparator and the group ordering (DRY).
export const STATUS_ORDER = ["in_progress", "in_review", "ready", "todo", "backlog", "open", "blocked", "done", "cancelled"];
export const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];

export const rank = (order: string[], v: string | undefined): number => {
  const i = order.indexOf((v ?? "").toLowerCase());
  return i === -1 ? order.length : i;
};

/** Humanize a raw status/priority key for display; localize the well-known ones. */
export function humanLabel(raw: string | undefined, kind: "status" | "priority"): string {
  const v = (raw ?? "").toLowerCase();
  const t = vscode.l10n.t;
  if (kind === "status") {
    const lane = TASK_LANES.find((l) => l.key === v);
    if (lane) return t(lane.label);
    if (v === "open") return t("Open");
    if (v === "canceled") return t("Cancelled");
  } else {
    const known: Record<string, string> = { urgent: t("Urgent"), high: t("High"), medium: t("Medium"), low: t("Low") };
    if (known[v]) return known[v];
  }
  if (!v) return kind === "status" ? t("No status") : t("No priority");
  return v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** `KEY title` — the row label in both sections. */
export function taskRowLabel(task: BfTask): string {
  return `${task.key ? `${task.key} ` : ""}${task.title}`;
}

/** The status icon: archived, cancelled and done read distinctly; epics keep their glyph. */
export function taskStatusIcon(task: BfTask): vscode.ThemeIcon {
  if (task.archived) return new vscode.ThemeIcon("archive");
  if (isCancelledTaskStatus(task.status)) return new vscode.ThemeIcon("circle-slash");
  if (isClosedTask(task)) return new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed"));
  if (task.taskType === "epic") return new vscode.ThemeIcon("type-hierarchy");
  switch (task.status) {
    case "in_progress":
      return new vscode.ThemeIcon("loading~spin");
    case "in_review":
      return new vscode.ThemeIcon("git-pull-request");
    case "blocked":
      return new vscode.ThemeIcon("error");
    default:
      return new vscode.ThemeIcon("circle-outline");
  }
}
