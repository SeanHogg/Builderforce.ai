/**
 * The ONE status-bar item for platform health. Hidden while the platform is online; shown when it is
 * degraded or unreachable. A non-online state must persist for {@link SHOW_DELAY_MS} before it shows
 * (so a single blip does not flap the bar); recovery hides it immediately. Click runs Diagnose.
 */

import * as vscode from "vscode";
import { platformHealth, type PlatformHealthSignal, type PlatformHealthState } from "./bfApi/platformHealth";

export const SHOW_DELAY_MS = 5000;
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
  delayMs: number = SHOW_DELAY_MS,
): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
  item.name = vscode.l10n.t("BuilderForce platform status");
  item.command = DIAGNOSE_COMMAND;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = false;

  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const apply = (): void => {
    const state = health.state();
    if (state === "online") {
      clearTimer();
      shown = false;
      item.hide();
      return;
    }
    if (shown) return paint(item, state); // already visible: switch degraded/offline at once
    if (timer !== undefined) return; // already waiting for the state to persist
    timer = setTimeout(() => {
      timer = undefined;
      const current = health.state();
      if (current === "online") return;
      shown = true;
      paint(item, current);
    }, delayMs);
  };

  context.subscriptions.push(item, { dispose: health.subscribe(apply) }, { dispose: clearTimer });
  apply();
}
