import { chatErrorAction, type ChatErrorAction } from "@seanhogg/builderforce-brain-embedded/chatError";
import * as vscode from "vscode";
import { getWebBaseUrl } from "./gateway";

/**
 * Turn an entitlement failure into somewhere the user can actually GO — the host
 * half of the webview's `<ChatErrorBanner>`.
 *
 * The native `@builderforce` chat participant streams markdown, not React, so it
 * can't render the banner's button; without this it printed "**Error:** Premium
 * models … require a validated card on file. Add and validate a card in Settings
 * ▸ Billing to unlock." and left the user to find Settings ▸ Billing themselves,
 * in a product they may only ever have used inside the editor.
 *
 * Classification is the SHARED {@link chatErrorAction} (a React-free subpath of
 * brain-embedded), so both surfaces agree on what a given failure means and where
 * it should send the user.
 */

/** Where each verdict lands in the web app. Mirrors `UPGRADE_PATHS` in the webview's
 *  `accountPlan.tsx` — `/pricing` is the billing console, and `?upgrade=pro`
 *  pre-opens the upgrade form. */
const PATHS = {
  upgrade: "/pricing?upgrade=pro",
  validate_card: "/pricing",
} as const;

/** A rendered call-to-action, or null when the failure isn't an entitlement one. */
export interface UpgradeAction {
  label: string;
  url: string;
}

/**
 * The action for an error, if any. `auth` is deliberately excluded: reconnecting
 * is an in-editor command, not a web page, and the surfaces that show it already
 * offer their own sign-in affordance.
 */
export function upgradeActionFor(error: unknown): UpgradeAction | null {
  return upgradeActionForVerdict(chatErrorAction(error));
}

/**
 * The same call-to-action, from an ALREADY-CLASSIFIED verdict.
 *
 * The shared run loop classifies a failure once (on the run cell's `errorAction`) and
 * surfaces the sentence separately — the original thrown value is gone by the time a
 * host reads it. Rendering from the verdict keeps that path on the SAME mapping as the
 * throw-carrying one instead of re-deriving it from error prose.
 */
export function upgradeActionForVerdict(action: ChatErrorAction | null): UpgradeAction | null {
  if (!action || action.kind === "auth") return null;

  const url = `${getWebBaseUrl()}${PATHS[action.kind]}`;
  if (action.kind === "validate_card") {
    return { label: vscode.l10n.t("Add a card"), url };
  }
  const plan = action.requiredPlan
    ? action.requiredPlan.replace(/^./, (ch) => ch.toUpperCase())
    : null;
  return {
    label: plan ? vscode.l10n.t("Upgrade to {0}", plan) : vscode.l10n.t("Upgrade"),
    url,
  };
}

/**
 * An error formatted for a markdown chat stream, with the fix appended as a link
 * when there is one. Returns just the message otherwise, so a plain failure reads
 * exactly as it did before.
 */
export function formatChatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return formatChatErrorVerdict(message, chatErrorAction(error));
}

/** {@link formatChatError} for a message whose verdict was classified elsewhere (the
 *  shared run loop's `errorAction`). One renderer for both entry points. */
export function formatChatErrorVerdict(message: string, action: ChatErrorAction | null): string {
  const cta = upgradeActionForVerdict(action);
  return cta ? `${message}\n\n[${cta.label}](${cta.url})` : message;
}
