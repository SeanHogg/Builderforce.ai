/**
 * The ONE status-bar item for platform health. Hidden while the platform is online; shown when it is
 * degraded or unreachable. It paints the hysteresis-STABLE state of the health signal (shown after 2
 * non-online answers in 30s or one sustained 5s; hidden after 30s of continuous online answers — see
 * `bfApi/platformHealth.ts`), so it carries no timing of its own. Click runs Diagnose.
 */

import * as vscode from "vscode";
import { platformHealth, type PlatformHealthSignal, type PlatformHealthState } from "./bfApi/platformHealth";

const DIAGNOSE_COMMAND = "builderforce.diagnose";

function paint(item: vscode.StatusBarItem, state: Exclude<PlatformHealthState, "online">): void {
  const worksLocally = vscode.l10n.t("Still works: local tools, local chats and local models.");
  const needsPlatform = vscode.l10n.t("Unavailable until it recovers: cloud models and sync (your changes are queued and sent later).");
  item.text = state === "unreachable"
    ? vscode.l10n.t("$(cloud-offline) BuilderForce offline")
    : vscode.l10n.t("$(warning) BuilderForce degraded");
  item.tooltip = [
    state === "unreachable"
      ? vscode.l10n.t("BuilderForce cannot be reached.")
      : vscode.l10n.t("BuilderForce is reachable but having trouble serving requests."),
    worksLocally,
    needsPlatform,
    vscode.l10n.t("Click to run Diagnose Connection."),
  ].join("\n");
  item.show();
}

export function registerPlatformHealthStatus(
  context: vscode.ExtensionContext,
  health: PlatformHealthSignal = platformHealth,
): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
  item.name = vscode.l10n.t("BuilderForce platform status");
  item.command = DIAGNOSE_COMMAND;

  // No debounce of its own: `health.state()` is already the hysteresis-stable state, so the
  // item simply shows it (a per-response timer here is what made the bar flap).
  const apply = (): void => {
    const state = health.state();
    if (state === "online") item.hide();
    else paint(item, state);
  };

  context.subscriptions.push(item, { dispose: health.subscribe(apply) });
  apply();
}
