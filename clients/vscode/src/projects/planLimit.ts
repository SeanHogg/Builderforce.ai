import * as vscode from "vscode";
import { getWebBaseUrl } from "../gateway/gateway";

/**
 * The shared 402 plan-limit response: show the surface-specific `message` with an
 * "Open BuilderForce" action that deep-links to workspace settings, where the upgrade
 * lives (a web-app action).
 */
export async function handlePlanLimit(message: string): Promise<void> {
  const action = await vscode.window.showErrorMessage(message, vscode.l10n.t("Open BuilderForce"));
  if (action) void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/settings`));
}
