/**
 * The editor's face of model provisioning (`provision.ts`): one notification with a
 * progress bar while Bonsai downloads, then a line saying Hybrid now runs on this
 * machine first — or why it could not. Cancelling the notification stops the download.
 */
import * as vscode from "vscode";
import type { ProvisionEvent } from "./provision";

export function provisionProgressReporter(): (event: ProvisionEvent) => void {
  let progress: vscode.Progress<{ message?: string; increment?: number }> | undefined;
  let finish: (() => void) | undefined;
  let shown = 0;
  return (event) => {
    switch (event.kind) {
      case "start":
        void vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t("Setting up {0} to run turns on this machine…", event.model.label),
            cancellable: true,
          },
          (p, token) =>
            new Promise<void>((resolve) => {
              progress = p;
              finish = resolve;
              token.onCancellationRequested(event.cancel);
            }),
        );
        return;
      case "progress": {
        const percent = Math.floor(event.fraction * 100);
        if (percent <= shown) return;
        progress?.report({ increment: percent - shown, message: `${percent}%` });
        shown = percent;
        return;
      }
      case "done":
        finish?.();
        void vscode.window.showInformationMessage(
          vscode.l10n.t("{0} is ready. Hybrid now runs turns on this machine first.", event.model.label),
        );
        return;
      case "cancelled":
        finish?.();
        return;
      case "failed":
        finish?.();
        void vscode.window.showWarningMessage(
          vscode.l10n.t("Could not download {0} for on-device turns: {1}", event.model.label, event.error),
        );
        return;
    }
  };
}
