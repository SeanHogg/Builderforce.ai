/**
 * Localized copy for live sub-agents in the Brain panel — the strip above the composer,
 * the owner / sub-agent tags in the transcript, and steering a queued message into the
 * running turn. Translated through `vscode.l10n` like every panel string and merged into
 * the panel's label bundle; its own module so the panel does not grow for it.
 */

import * as vscode from "vscode";

export function subagentLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    // <BrainTimeline>: whose a sub-agent's reply is, and that the chat's agent owns them.
    // `{owner}` is substituted by the renderer, not by l10n.
    "tl.subagentOf": t("sub-agent of {owner}"),
    "tl.ownerTag": t("owner"),
    // <SubagentStrip>
    "sub.region": t("Sub-agents working in this chat"),
    "sub.title": t("Sub-agents ({count})"),
    "sub.stopAll": t("Stop all"),
    "sub.collapse": t("Hide sub-agents"),
    "sub.expand": t("Show sub-agents"),
    "sub.asks": t("{name} wants to run"),
    "sub.redirect": t("Redirect"),
    "sub.stop": t("Stop"),
    "sub.redirectPlaceholder": t("Tell {name} what to do differently…"),
    "sub.redirectAria": t("Direction for {name}"),
    "sub.send": t("Send"),
    // A queued message pushed into the running turn instead of waiting for it to finish.
    "app.steerNow": t("Steer now"),
    "app.steerNowHint": t("Send it into the running turn now instead of after it"),
  };
}
