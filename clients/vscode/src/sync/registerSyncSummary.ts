/**
 * The sync summary's status-bar item and its command (G23), registered on the activation path.
 *
 * The item is a READ of the store (`readSyncSummary`), refreshed after commits and policy changes.
 * It is never awaited by anything: a local write finishes before, and regardless of, this repaint.
 */

import * as vscode from "vscode";
import type { DurableLocalFirstStore } from "../durableLocalFirstStore";
import { platformPolicy } from "../platformPolicy";
import { hostSyncSummaryPorts } from "./hostSyncSummary";
import { readSyncSummary, type SyncSummary } from "./syncSummary";

export const SHOW_SYNC_SUMMARY_COMMAND = "builderforce.showSyncSummary";

/** How long commits are coalesced before the item repaints. */
const REPAINT_DELAY_MS = 250;

function bytesText(bytes: number): string {
  if (bytes < 1024) return vscode.l10n.t("{0} B", bytes);
  if (bytes < 1024 * 1024) return vscode.l10n.t("{0} KB", (bytes / 1024).toFixed(1));
  return vscode.l10n.t("{0} MB", (bytes / (1024 * 1024)).toFixed(1));
}

function whenText(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleString(vscode.env.language) : vscode.l10n.t("never");
}

function modeText(mode: SyncSummary["mode"]): string {
  if (mode === "local-only") return vscode.l10n.t("Local only");
  if (mode === "specific") return vscode.l10n.t("Specific");
  return vscode.l10n.t("Hybrid");
}

/** The summary as one line per fact, in the editor's language. */
export function syncSummaryLines(summary: SyncSummary): string[] {
  return [
    vscode.l10n.t("Mode: {0}", modeText(summary.mode)),
    summary.destination.kind === "bound"
      ? vscode.l10n.t("Destination: {0}", summary.destination.label)
      : vscode.l10n.t("Destination: no account (this device only)"),
    vscode.l10n.t("Queued: {0} items ({1})", summary.queued.items, bytesText(summary.queued.bytes)),
    vscode.l10n.t("Conflicts: {0}", summary.conflicts),
    vscode.l10n.t("Failed (dead letters): {0}", summary.deadLetters),
    vscode.l10n.t("Last push: {0}", whenText(summary.lastPushAt)),
    vscode.l10n.t("Last pull: {0}", whenText(summary.lastPullAt)),
  ];
}

function paint(item: vscode.StatusBarItem, summary: SyncSummary): void {
  const attention = summary.conflicts > 0 || summary.deadLetters > 0;
  const icon = attention ? "$(warning)" : summary.queued.items > 0 ? "$(sync)" : "$(check)";
  item.text = `${icon} ${summary.queued.items}`;
  item.tooltip = syncSummaryLines(summary).join("\n");
  item.backgroundColor = attention ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
  item.show();
}

export function registerSyncSummary(context: vscode.ExtensionContext, store: DurableLocalFirstStore): void {
  const ports = hostSyncSummaryPorts(store);
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  item.name = vscode.l10n.t("BuilderForce sync");
  item.command = SHOW_SYNC_SUMMARY_COMMAND;
  let latest: SyncSummary | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const repaint = (): void => {
    void readSyncSummary(ports).then((summary) => {
      latest = summary;
      paint(item, summary);
    }).catch(() => { /* a failed local read leaves the last paint standing */ });
  };
  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; repaint(); }, REPAINT_DELAY_MS);
  };

  context.subscriptions.push(
    item,
    { dispose: store.subscribe(schedule) },
    { dispose: platformPolicy().subscribe(schedule) },
    { dispose: () => { if (timer !== undefined) clearTimeout(timer); } },
    vscode.commands.registerCommand(SHOW_SYNC_SUMMARY_COMMAND, async () => {
      const summary = latest ?? await readSyncSummary(ports);
      void vscode.window.showInformationMessage(syncSummaryLines(summary).join("  |  "));
    }),
  );
  repaint();
}
