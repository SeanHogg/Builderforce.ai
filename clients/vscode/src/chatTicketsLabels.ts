/**
 * Localized copy for the chat's ticket rail — the shared `ChatTicketsPanel` (linked
 * tickets and their health, the sort control, agents, people, merge, questions).
 * Translated through `vscode.l10n` like every panel string and merged into the panel's
 * label bundle under `ct.*`; the webview reads it back through brain-ui's
 * `chatTicketsLabelsFromBundle`, which names the keys and keeps the English default for
 * any it lacks. Its own module so the panel does not grow for it.
 *
 * The parametric strings are TEMPLATES (`{label}`, `{pct}`, `{parent}`, `{n}`, `{agent}`,
 * `{owner}`) filled by the renderer, not by l10n, so they stay literal here.
 */

import * as vscode from "vscode";

export function chatTicketsLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    "ct.none": t("No tickets linked yet."),
    // The chat's first prompt (migration 1245), shown read-only above the linked tickets.
    "ct.originalRequest": t("Original request"),
    "ct.originalRequestText": t("Original request: {text}"),
    "ct.ringAria": t("{label}: {pct}% done"),
    "ct.inParent": t("in {parent}"),
    "ct.spawned": t("spawned here"),
    "ct.open": t("Open"),
    "ct.run": t("Run agent on ticket"),
    "ct.lineage": t("Chat lineage"),
    "ct.unlink": t("Unlink"),
    "ct.pickAgent": t("Run as agent…"),
    "ct.lineageTitle": t("Chats for this ticket"),
    "ct.lineageEmpty": t("No other chats reference this ticket."),
    "ct.merged": t("merged"),
    "ct.runStarted": t("Started {agent} on the ticket."),
    "ct.runNoAgent": t("No agent could run this ticket — assign one first."),
    "ct.runFailed": t("Could not start the run."),
    "ct.link": t("Link ticket"),
    "ct.agents": t("Agents"),
    "ct.merge": t("Merge"),
    "ct.linkFailed": t("Could not link — check the ticket exists."),
    "ct.kindLabel": t("Ticket type"),
    "ct.pickTicket": t("Choose a ticket…"),
    "ct.searchTicket": t("Search tickets…"),
    "ct.searching": t("Searching…"),
    "ct.noMatches": t("No matching tickets."),
    "ct.refine": t("Showing the top matches — type to narrow."),
    "ct.linkTypeLabel": t("Link type"),
    "ct.linkTypeLinked": t("Linked"),
    "ct.linkTypeCreated": t("Created from chat"),
    "ct.linkAction": t("Link"),
    "ct.noAgents": t("No agents in this chat yet."),
    "ct.removeAgent": t("Remove"),
    "ct.inviteAgent": t("Invite an agent…"),
    "ct.agentsHint": t("Type @ in the message box to tag an invited agent — it replies in the chat and can act on the team's work — or run it on a linked task/epic above."),
    "ct.subagentOf": t("sub-agent of {owner}"),
    "ct.people": t("People"),
    "ct.noPeople": t("No people invited yet."),
    "ct.invitePerson": t("Invite by email…"),
    "ct.invitePersonHint": t("Invite a teammate to view and collaborate on this chat."),
    "ct.removePerson": t("Remove"),
    "ct.inviteSent": t("Invitation sent."),
    "ct.invitePending": t("Invite sent — they will join when they sign in."),
    "ct.visibilityShared": t("Shared"),
    "ct.visibilityLocked": t("Locked"),
    "ct.lockHint": t("Shared chats are visible to the whole team; lock to keep this chat to its members only."),
    "ct.mergeHint": t("Merge other chats into this one. Their messages, tickets and agents move here; the sources are archived."),
    "ct.mergeNoOthers": t("No other chats to merge."),
    "ct.questions": t("Questions"),
    "ct.noQuestions": t("No pending questions."),
    "ct.answerPlaceholder": t("Type your answer…"),
    "ct.submitAnswer": t("Answer"),
    "ct.answering": t("Sending…"),
    "ct.showTickets": t("Show linked tickets"),
    "ct.hideTickets": t("Hide linked tickets"),
    "ct.sortLabel": t("Sort tickets"),
    "ct.sortOpen": t("Incomplete first"),
    "ct.sortDone": t("Complete first"),
    "ct.sortTitle": t("Title"),
    "ct.sortLinked": t("Linked order"),
    "ct.ticketCountOne": t("{n} ticket"),
    "ct.ticketCountMany": t("{n} tickets"),
    "ct.overallAria": t("Overall progress: {pct}% done"),
    "ct.mergeAction": t("Merge {n} here"),
    "ct.mergedN": t("Merged {n} chat(s)."),
    "ct.kind.task": t("Task"),
    "ct.kind.epic": t("Epic"),
    "ct.kind.gap": t("Gap"),
    "ct.kind.objective": t("Objective"),
    "ct.kind.initiative": t("Initiative"),
    "ct.kind.portfolio": t("Portfolio"),
    "ct.kind.roadmap": t("Roadmap"),
    "ct.kind.spec": t("Spec"),
    "ct.kind.retro": t("Retrospective"),
    "ct.kind.poker": t("Planning poker"),
  };
}
