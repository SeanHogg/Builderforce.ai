/**
 * The continuation turn Resume sends for an interrupted run (chat #61651): built from the run's JOURNALED record, not the
 * bare "Continue the task that was interrupted when the editor closed." that left the resumed run without its plan - it
 * recalled another session's task on that generic text, concluded nothing was pending and changed nothing.
 *
 * The turn carries the original ask verbatim, the plan as it stood, the files changed so far, the last steps and what
 * became of the sub-agents (`describeInterruptedChildren`), and scopes the run to THIS chat's task. The headings are the
 * panel's localized `ir.*` labels (`interruptedRunsLabels.ts`, read in the webview through `makeT`); the dynamic parts are
 * data, quoted as journaled. The ask also becomes the run's request text, so the run's recall is asked about THIS task.
 *
 * Pure (no `vscode`, no DOM): the webview imports it, as it imports `idePersona`.
 */

import type { InterruptedRunResume } from "./interruptedRunsView";

/** A label lookup with its English default (`makeT`'s shape). */
export type ResumeLabel = (key: string, fallback: string) => string;

/** The English defaults of the `ir.continue*` keys - the single place they are spelled for the webview's fallback. */
export const RESUME_TURN_DEFAULTS = {
  "ir.continue": "Continue the task that was interrupted when the editor closed.",
  "ir.continueAsk": "The original request, verbatim:",
  "ir.continuePlan": "The plan when it stopped:",
  "ir.continueFiles": "Files changed so far:",
  "ir.continueSteps": "The last steps before it stopped:",
  "ir.continueChildren": "Sub-agents:",
  "ir.continueScope": "Continue only this chat's task above. Check what is already done before redoing it, and do not pick up any other session's work.",
} as const;

type ResumeKey = keyof typeof RESUME_TURN_DEFAULTS;

const quote = (text: string): string => text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
const list = (items: readonly string[]): string => items.map((item) => `- ${item}`).join("\n");

/** The continuation turn for an interrupted run; the headline alone when the run journaled nothing to continue from. */
export function interruptedResumeTurn(t: ResumeLabel, resume: InterruptedRunResume | undefined): string {
  const label = (key: ResumeKey): string => t(key, RESUME_TURN_DEFAULTS[key]);
  const sections: string[] = [label("ir.continue")];
  if (!resume) return sections[0]!;
  if (resume.ask) sections.push(`${label("ir.continueAsk")}\n${quote(resume.ask)}`);
  if (resume.plan) sections.push(`${label("ir.continuePlan")}\n${resume.plan}`);
  if (resume.files?.length) sections.push(`${label("ir.continueFiles")}\n${list(resume.files)}`);
  if (resume.steps?.length) sections.push(`${label("ir.continueSteps")}\n${list(resume.steps)}`);
  if (resume.children) sections.push(`${label("ir.continueChildren")}\n${resume.children}`);
  sections.push(label("ir.continueScope"));
  return sections.join("\n\n");
}
