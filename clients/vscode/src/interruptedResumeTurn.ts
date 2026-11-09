/**
 * The continuation turn Resume sends for an interrupted run (chat #61651): built from the run's JOURNALED record, not the
 * bare "Continue the task that was interrupted when the editor closed." that left the resumed run without its plan - it
 * recalled another session's task on that generic text, concluded nothing was pending and changed nothing.
 *
 * The turn carries the original ask verbatim, the plan as it stood, the files changed so far, the last steps and what
 * became of the sub-agents ({@link renderInterruptedChildren}), and scopes the run to THIS chat's task. Every word of it
 * is the panel's localized `ir.*` labels (`interruptedRunsLabels.ts`, read in the webview through `makeT`) - the turn is
 * sent as the person's own message, so it is in their language; the dynamic parts (ask, plan, files, steps, a child's
 * handle, label, owner, ticket, brief and report) are data, quoted as journaled. `{name}` placeholders in a label are
 * filled here. The ask also becomes the run's request text, so the run's recall is asked about THIS task.
 *
 * Pure (no `vscode`, no DOM, no host module): the webview imports it, as it imports `idePersona`.
 */

import type { InterruptedChildView, InterruptedRunResume } from "./interruptedRunTypes";

/** A label lookup with its English default (`makeT`'s shape). */
export type ResumeLabel = (key: string, fallback: string) => string;

/** The English defaults of the continuation turn's `ir.*` keys - the single place they are spelled for the fallback. */
export const RESUME_TURN_DEFAULTS = {
  "ir.continue": "Continue the task that was interrupted when the editor closed.",
  "ir.continueAsk": "The original request, verbatim:",
  "ir.continuePlan": "The plan when it stopped:",
  "ir.continueFiles": "Files changed so far:",
  "ir.continueSteps": "The last steps before it stopped:",
  "ir.continueChildren": "Sub-agents:",
  "ir.continueScope": "Continue only this chat's task above. Check what is already done before redoing it, and do not pick up any other session's work.",
  "ir.childrenStarted": "Sub-agents your interrupted run had started: {count}.",
  "ir.childrenDied": "{died} of them died with the editor and are NOT running now.",
  "ir.childTicket": "ticket {ticket}",
  "ir.childStartedBy": "started by {owner}",
  "ir.childInterrupted": "interrupted — not resumed; re-spawn or do it yourself",
  "ir.childBrief": "Its brief was:",
  "ir.childReturned": "{state} — its report was already returned to you by wait_agents.",
  "ir.childReport": "{state} — its report:",
  "ir.childNoReport": "{state}, no report kept.",
  "ir.childState.running": "running",
  "ir.childState.done": "done",
  "ir.childState.failed": "failed",
  "ir.childState.stopped": "stopped",
} as const;

type ResumeKey = keyof typeof RESUME_TURN_DEFAULTS;

const quote = (text: string): string => text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
const list = (items: readonly string[]): string => items.map((item) => `- ${item}`).join("\n");
const indent = (text: string): string => text.split(/\r?\n/).map((line) => `    ${line}`).join("\n");

/** A label's `{name}` placeholders filled with data. */
const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));

const labelsOf = (t: ResumeLabel) => (key: ResumeKey, values?: Readonly<Record<string, string | number>>): string => {
  const text = t(key, RESUME_TURN_DEFAULTS[key]);
  return values ? fill(text, values) : text;
};

/**
 * What a resumed parent is told about the sub-agents its interrupted run had started, in the person's language: every
 * child accounted for - reports of the finished ones delivered (or noted as already returned by `wait_agents`), and every
 * child that was still running reported as interrupted with its brief. Empty when the run started none.
 */
export function renderInterruptedChildren(t: ResumeLabel, children: readonly InterruptedChildView[] | undefined): string {
  if (!children?.length) return "";
  const label = labelsOf(t);
  const sections = children.map((c) => {
    const detail = [c.label, ...(c.ticket ? [label("ir.childTicket", { ticket: c.ticket })] : [])].join(", ");
    const who = `${c.handle} (${detail}; ${label("ir.childStartedBy", { owner: c.owner })})`;
    const state = label(`ir.childState.${c.state}` as const);
    if (c.state === "running") return `- ${who}: ${label("ir.childInterrupted")}. ${label("ir.childBrief")}\n${indent(c.brief ?? "")}`;
    if (c.deliveredBy === "wait") return `- ${who}: ${label("ir.childReturned", { state })}`;
    return c.report ? `- ${who}: ${label("ir.childReport", { state })}\n${indent(c.report)}` : `- ${who}: ${label("ir.childNoReport", { state })}`;
  });
  const died = children.filter((c) => c.state === "running").length;
  const head = [label("ir.childrenStarted", { count: children.length }), ...(died ? [label("ir.childrenDied", { died })] : [])].join(" ");
  return [head, ...sections].join("\n");
}

/** The continuation turn for an interrupted run; the headline alone when the run journaled nothing to continue from. */
export function interruptedResumeTurn(t: ResumeLabel, resume: InterruptedRunResume | undefined): string {
  const label = labelsOf(t);
  const sections: string[] = [label("ir.continue")];
  if (!resume) return sections[0]!;
  if (resume.ask) sections.push(`${label("ir.continueAsk")}\n${quote(resume.ask)}`);
  if (resume.plan) sections.push(`${label("ir.continuePlan")}\n${resume.plan}`);
  if (resume.files?.length) sections.push(`${label("ir.continueFiles")}\n${list(resume.files)}`);
  if (resume.steps?.length) sections.push(`${label("ir.continueSteps")}\n${list(resume.steps)}`);
  if (resume.children?.length) sections.push(`${label("ir.continueChildren")}\n${renderInterruptedChildren(t, resume.children)}`);
  sections.push(label("ir.continueScope"));
  return sections.join("\n\n");
}
