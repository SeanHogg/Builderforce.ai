/**
 * Localized copy for the composer Status tab's Connected accounts section (each provider
 * account's health, Test, and the in-chat Reconnect). Translated through `vscode.l10n`
 * and merged into the panel's label bundle; the webview maps `conn.<key>` onto brain-ui's
 * `ConnectionsLabels` (`webview/src/chat/composerLabels.ts`). Its own module so the
 * Status tab's copy does not grow one file.
 *
 * `{code}` is substituted by the component, not by l10n.
 */

import * as vscode from "vscode";

export function connectionsLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    "conn.heading": t("Connected accounts"),
    "conn.empty": t("No provider accounts connected."),
    "conn.loadFailed": t("Could not load connected accounts."),
    "conn.unavailable": t("Connected accounts are not available from here."),
    "conn.authOauth": t("Subscription"),
    "conn.authApiKey": t("API key"),
    "conn.healthOk": t("Working"),
    "conn.healthCapacity": t("Usage limit reached — add credits or wait for the reset"),
    "conn.healthNotEntitled": t("Signed in, but the plan does not cover this model"),
    "conn.healthRejected": t("Sign-in expired — reconnect"),
    "conn.healthUnresolved": t("Credential could not be read — reconnect"),
    "conn.test": t("Test"),
    "conn.testing": t("Testing…"),
    "conn.testOk": t("Connection works"),
    "conn.reconnect": t("Reconnect"),
    "conn.pasteHint": t("Sign in on the page that opened, then paste the code it shows."),
    "conn.pastePlaceholder": t("Paste code"),
    "conn.finish": t("Finish"),
    "conn.finishing": t("Finishing…"),
    "conn.cancel": t("Cancel"),
    "conn.deviceHint": t("Approve in your browser — the page shows code {code}."),
    "conn.reconnected": t("Reconnected"),
    "conn.errDenied": t("The connection was declined."),
    "conn.errExpired": t("That code expired — reconnect again."),
    "conn.errStart": t("Could not start reconnecting."),
    "conn.errFailed": t("Could not reconnect."),
  };
}
