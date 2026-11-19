import * as vscode from "vscode";
import { isLlmProvider, llmProviderInfo } from "@builderforce/model-catalog";
import type { ProviderTestResult } from "@builderforce/provider-connect";
import { accountTestHealth, type AccountTestReport } from "@builderforce/provider-connect/accounts";
import { editorAccounts } from "./providerConnect";

/**
 * Test a connected account THIS EDITOR calls itself (Kimi Code) from this machine — the
 * Connections picker's Test and the composer's Status-tab Test both land here.
 *
 * The gateway's Test cannot answer for such an account: it reaches Kimi Code only through
 * an online agent host, and the editor is not one, so it reported "reachable only from a
 * machine of your own" for an account that works perfectly from the editor. The probe is
 * the shared one (`testAccountFromThisMachine`), with the account's own credential and one
 * minimal real request; this module only words its answer.
 *
 * `null` for a provider the editor does not call itself — the caller runs the gateway's Test.
 */
export async function testAccountFromEditor(secrets: vscode.SecretStorage, provider: string): Promise<ProviderTestResult | null> {
  const report = await editorAccounts(secrets).testFromThisMachine(provider, (input, init) => fetch(input, init));
  if (!report) return null;
  return {
    ok: report.kind === "working",
    health: accountTestHealth(report),
    message: describeAccountTest(report, providerLabel(provider)),
  };
}

function providerLabel(provider: string): string {
  return isLlmProvider(provider) ? llmProviderInfo(provider).label : provider;
}

/** The person's sentence for a Test report: what the provider said from this machine, and what to do. */
export function describeAccountTest(report: AccountTestReport, label: string): string {
  switch (report.kind) {
    case "working":
      return vscode.l10n.t("{0} works from this machine (model {1}).", label, report.model);
    case "refused":
      if (report.remedy === "reconnect") {
        return vscode.l10n.t("{0} refused this machine's credential (HTTP {1}: {2}). Reconnect the account.", label, report.status, report.message);
      }
      if (report.remedy === "wait") {
        return vscode.l10n.t("{0} is out of capacity (HTTP {1}: {2}). Wait for your plan's usage window to reset.", label, report.status, report.message);
      }
      return vscode.l10n.t("{0} answered HTTP {1}: {2}", label, report.status, report.message);
    case "unreachable":
      return vscode.l10n.t("{0} could not be reached from this machine: {1}", label, report.detail);
    case "connect":
      return report.reason === "reconnect"
        ? vscode.l10n.t("{0} needs to be reconnected: {1}", label, report.detail ?? "")
        : vscode.l10n.t("{0} is not connected. Connect the account first.", label);
    default:
      return vscode.l10n.t("Could not get the {0} credential from Builderforce: {1}", label, report.detail);
  }
}
