import * as vscode from "vscode";
import { getWebBaseUrl } from "../gateway/gateway";

/** Server codes (and HTTP 429) that mean the plan's token budget is spent. */
const TOKEN_LIMIT_CODES: ReadonlySet<string> = new Set([
  "plan_token_limit_exceeded",
  "plan_monthly_token_limit_exceeded",
]);

/** Is this dispatch failure the plan token budget running out? */
export function isTokenLimitError(error: { code?: string; httpStatus?: number } | undefined): boolean {
  return (error?.code !== undefined && TOKEN_LIMIT_CODES.has(error.code)) || error?.httpStatus === 429;
}

/**
 * The token-budget (HTTP 429) outcome of a platform dispatch: the API's plan-tailored reason
 * (e.g. "Plan daily token limit reached (10,000 tokens)…") with a direct upgrade / usage path,
 * instead of the raw dispatch error.
 */
export async function showTokenLimitNotice(label: string, serverMessage: string | undefined): Promise<void> {
  const reason = serverMessage ?? vscode.l10n.t("Your workspace has reached its plan token limit for now.");
  const upgrade = vscode.l10n.t("Upgrade to Pro");
  const usage = vscode.l10n.t("View Usage");
  const action = await vscode.window.showErrorMessage(
    vscode.l10n.t("BuilderForce: can't run {0} — {1}", label, reason),
    upgrade,
    usage,
  );
  if (action === upgrade) void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/pricing`));
  else if (action === usage) void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/settings`));
}
