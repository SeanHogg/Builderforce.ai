/**
 * A delegated child, reporting back to the CHAT.
 *
 * A child's answer used to reach only its parent, as one tool result the user saw as a
 * collapsed step — four coders could finish four tickets and the conversation said
 * nothing until the parent summarised them. Each child now posts its own message when it
 * finishes, so a fan-out reads in the chat the way a team does: one report per ticket,
 * as each lands.
 *
 * Tagged mid-turn (`MID_TURN_META_KEY`): a child's report is progress inside a run, not
 * the run's answer, so Evermind does not learn it as one. Pure, and here beside
 * `runSubagent` so every surface that runs a child — the editor and the cloud — posts
 * the same report.
 */

import { MID_TURN_META_KEY } from "./turnPhase.js";

/** The fields of a finished child's report this message reads. */
export interface SubagentReportLike {
  ok: boolean;
  label: string;
  output?: string;
  error?: string;
  ticket?: string;
  asAgent?: { ref?: string; name: string };
  changedFiles?: readonly string[];
  truncated?: boolean;
  note?: string;
}

/** Key under which the report's identity rides in the message metadata. */
export const SUBAGENT_REPORT_META_KEY = "subagentReport";

/** Longest child answer quoted into the chat; the parent holds the full result. */
const MAX_OUTPUT_CHARS = 3_000;
const MAX_FILES_LISTED = 12;

/** The chat message for one finished child. */
export function subagentReportMessage(report: SubagentReportLike): string {
  const who = report.asAgent?.name ? `${report.asAgent.name} — ` : "";
  const ticket = report.ticket && !report.label.startsWith(`#${report.ticket}`) ? `#${report.ticket} ` : "";
  const status = report.ok ? (report.truncated ? "partial" : "done") : "failed";
  const head = `**${who}${ticket}${report.label}** · ${status}`;
  const body = report.ok
    ? (report.output ?? "").trim()
    : (report.error ?? "the sub-agent stopped without an answer").trim();
  const quoted = body.length > MAX_OUTPUT_CHARS ? `${body.slice(0, MAX_OUTPUT_CHARS)}…` : body;
  const files = report.changedFiles?.length
    ? `Changed: ${report.changedFiles.slice(0, MAX_FILES_LISTED).map((f) => `\`${f}\``).join(", ")}${report.changedFiles.length > MAX_FILES_LISTED ? ` (+${report.changedFiles.length - MAX_FILES_LISTED} more)` : ""}`
    : "";
  return [head, quoted, files, report.note ?? ""].filter(Boolean).join("\n\n");
}

/** Metadata for the report message: mid-turn, plus who reported on which ticket. */
export function subagentReportMetadata(report: SubagentReportLike): string {
  return JSON.stringify({
    [MID_TURN_META_KEY]: true,
    [SUBAGENT_REPORT_META_KEY]: {
      label: report.label,
      ok: report.ok,
      ...(report.ticket ? { ticket: report.ticket } : {}),
      ...(report.asAgent ? { asAgent: report.asAgent.name } : {}),
    },
  });
}
