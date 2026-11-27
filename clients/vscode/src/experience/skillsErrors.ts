import * as vscode from "vscode";
import { HelperError } from "./teachHelperProtocol";

/**
 * A caught error in words the person can act on, localized. Helper error codes get their
 * own sentence (the helper's English `message` is for logs); the approvals client's
 * "not signed in" is mapped too; anything else keeps its own message.
 */
export function explainError(error: unknown): string {
  if (error instanceof HelperError) {
    switch (error.code) {
      case "busy":
        return vscode.l10n.t("Synapse is already recording or running something.");
      case "missing_value":
        return vscode.l10n.t("A secret value is missing. Type it in, or tick Remember on this computer.");
      case "unsupported":
        return vscode.l10n.t("Not available on this system");
      case "idle":
        return vscode.l10n.t("Nothing is running.");
      case "record_failed":
        return vscode.l10n.t("Recording could not start: {0}", error.message);
      case "helper_gone":
        return vscode.l10n.t("The Teach helper stopped unexpectedly.");
      case "timeout":
        return vscode.l10n.t("The Teach helper did not answer in time.");
      default:
        return error.message;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return message === "not signed in" ? vscode.l10n.t("Sign in to BuilderForce first.") : message;
}
