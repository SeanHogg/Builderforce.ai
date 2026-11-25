/**
 * Localized copy for the shared composer's Status tab (plan, usage meters, Evermind)
 * and the spend & savings readouts (the chat's spend pill and its breakdown).
 * Translated through `vscode.l10n` like every panel string and merged into the panel's
 * label bundle; the webview maps these keys onto brain-ui's label shapes in ONE place
 * (`webview/src/chat/composerLabels.ts`). Its own module so the panel does not grow.
 *
 * `{…}` placeholders are substituted by the components, not by l10n. Meter, unit, plan
 * and billing keys are the server's own keys, so a new one only needs a row here.
 */

import * as vscode from "vscode";

export function workStatusLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    // Status tab — account
    "app.usageEmpty": t("No usage meters for this plan."),
    "ws.limitsLifted": t("limits lifted"),
    "ws.limitsLiftedHint": t("You are a superadmin operator, so every limit is lifted for you — the plan’s own limits still apply to its members."),
    "ws.meterOf": "{used} / {limit} {unit}",
    "ws.plan.free": t("Free"),
    "ws.plan.pro": t("Pro"),
    "ws.plan.teams": t("Teams"),
    "ws.plan.enterprise": t("Enterprise"),
    "ws.billing.past_due": t("Past due"),
    "ws.billing.canceled": t("Canceled"),
    "ws.billing.trialing": t("Trial"),
    "ws.billing.incomplete": t("Incomplete"),
    // Status tab — usage meters, by the server's meter key
    "ws.meter.ai_tokens": t("AI tokens"),
    "ws.meter.cloud_runs": t("Cloud runs"),
    "ws.meter.stage_sandbox_runs": t("Sandbox runs"),
    "ws.meter.ingestion": t("Ingestion"),
    "ws.meter.error_events": t("Error events"),
    "ws.meter.outbound_fetches": t("Outbound fetches"),
    "ws.meter.feedback_submissions": t("Feedback"),
    "ws.meter.replay_recordings": t("Recordings"),
    // …and their units
    "ws.unit.tokens": t("tokens"),
    "ws.unit.bytes": t("bytes"),
    "ws.unit.runs": t("runs"),
    "ws.unit.events": t("events"),
    "ws.unit.fetches": t("fetches"),
    "ws.unit.submissions": t("submissions"),
    "ws.unit.sandbox_runs": t("runs"),
    "ws.unit.recordings": t("recordings"),
    // Status tab — the project's Evermind, as its two facts
    "ws.evermind": "Evermind",
    "ws.evermindVersion": "v{version}",
    "ws.evermindLearning": t("Learning"),
    "ws.evermindFrozen": t("Not learning"),
    "ws.evermindAnswersOn": t("Answers on"),
    "ws.evermindAnswersOff": t("Answers off"),
    "ws.evermindHint": t("Learning: this project’s chats teach its Evermind. Answers: whether the Evermind may answer for a paid model. Change both in the Evermind view."),
    // Spend & savings — the chat's pill and the breakdown behind it
    "spend.spent": t("{amount} spent"),
    "spend.saved": t("{amount} saved"),
    "spend.savedApprox": t("≈{amount} saved"),
    "spend.tokens": t("{tokens} tok"),
    "spend.pillTitle": t("What this conversation cost, and what memory saved"),
    "spend.spendHeading": t("Spent"),
    "spend.platform": t("Builderforce plan"),
    "spend.yourKey": t("Your key"),
    "spend.yourKeyHint": t("At the provider’s list price"),
    "spend.unpriced": t("{tokens} tokens on unpriced models"),
    "spend.savedHeading": t("Saved by memory"),
    "spend.savedShare": t("{pct}% of the bill"),
    "spend.estimated": t("estimate"),
    "spend.measured": t("recorded"),
    "spend.events": "{count}×",
    "spend.nothingSaved": t("Nothing saved yet"),
    "spend.periodHeading": t("AI spend · last {days} days"),
    "spend.source.prompt_cache": t("Prompt cache"),
    "spend.source.memory_answer": t("Answered from memory"),
    "spend.source.evermind_answer": t("Answered by Evermind"),
    "spend.source.response_cache": t("Repeated request"),
    "spend.source.context_trim": t("Context kept lean"),
    "spend.source.recall_overhead": t("Recall added"),
    "spend.source.local_model": t("On this machine"),
    "spend.source.deterministic": t("Answered by a workspace tool"),
    "spend.sourceHint.prompt_cache": t("The provider served part of the prompt from its cache at a tenth of the price"),
    "spend.sourceHint.memory_answer": t("A question asked before was answered from memory — no model call"),
    "spend.sourceHint.evermind_answer": t("The project’s Evermind answered — no paid model call"),
    "spend.sourceHint.response_cache": t("An identical request was answered from the gateway cache — no model call"),
    "spend.sourceHint.context_trim": t("Compaction kept earlier turns out of each call"),
    "spend.sourceHint.recall_overhead": t("What recalled memories added to each prompt — the cost of recall"),
    "spend.sourceHint.local_model": t("A model on this machine served the call — what your paid route would have charged for the same tokens"),
    "spend.sourceHint.deterministic": t("A deterministic workspace action answered — no model call (estimated at a median turn)"),
  };
}
