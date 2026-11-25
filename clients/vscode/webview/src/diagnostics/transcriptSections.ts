/**
 * The FIXED sections of the copied transcript — everything that is not the timeline.
 *
 * Split from `transcript.ts` so the report can measure what it must carry before it
 * decides how much room the timeline gets (`buildTranscript` gives the timeline
 * `ceiling − fixed`). Pure: takes the already-merged events, returns lines.
 */

import {
  computeBrainDiagnostics,
  detectUnbackedTicketClaim,
  detectUnbackedWriteClaim,
  UNBACKED_TICKET_CLAIM_NOTICE,
  UNBACKED_WRITE_CLAIM_NOTICE,
  formatBrainDiagnostics,
  formatBrainProvenance,
  formatChatDiagnostics,
  formatChatDiagnosticsReportJson,
  midRunNotice,
  formatSubagentDiagnostics,
  truncateMiddle,
} from '@seanhogg/builderforce-brain-embedded';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import type { TranscriptInput } from './transcript';

/** The conversation error is free text of unknown size; bound it so it cannot crowd the JSON out. */
const MAX_ERROR_CHARS = 4_000;
/** A chat title is user-authored; bound it in the header. */
const MAX_TITLE_CHARS = 200;

/** Title, chat/project provenance, chat diagnostics, run diagnostics, notices, flags. */
export function buildHeadLines(input: TranscriptInput, events: BrainTraceEvent[]): string[] {
  const lines: string[] = ['# BuilderForce chat transcript'];

  // Chat + project provenance — a pasted transcript should say WHICH conversation
  // and project it came from, not just the turns.
  if (input.chatTitle || input.chatId != null) {
    const title = truncateMiddle(input.chatTitle?.trim() ?? '', MAX_TITLE_CHARS) || 'Untitled chat';
    lines.push(`Chat: ${title}${input.chatId != null ? ` (#${input.chatId})` : ''}`);
  }
  lines.push(`Project: ${input.project ? `${input.project.name} (#${input.project.id})` : 'No project'}`);

  // Chat diagnostics — the identity + Evermind wiring state (project the CHAT is bound
  // to, tenant, head version/mode/learned/queued/last-learned, the last turn's learn-gate
  // outcome, invited agents, linked tickets) plus a Signals section naming the likely
  // cause of "connected yet nothing learns". Shared pure renderer (web parity later).
  if (input.diagnostics) {
    lines.push('');
    lines.push(...formatChatDiagnostics(input.diagnostics));
  }

  // Model + account provenance — surface, configured vs actual model, which account
  // served the turns, and any connected account the gateway could NOT use (e.g. an
  // expired Claude subscription that silently fell back to the shared pool — the
  // "should have used Opus" context). SHARED formatter, so this copy and the web
  // triage report stay identical.
  lines.push(...formatBrainProvenance(events, { configuredModel: input.model, surface: 'VS Code (VSIX)' }));
  lines.push('');

  // Diagnostics block — the verdict (tool calls never emitted / context exhaustion vs
  // model degradation) plus the token/tool-payload/downgrade numbers behind it. Same
  // shared builder the web triage report uses, so both copy surfaces agree. The
  // MESSAGES go in too: the "narrated a tool call, made none" verdict is only
  // reachable by reading the turns against the trace.
  if (events.length) {
    lines.push(
      ...formatBrainDiagnostics(
        computeBrainDiagnostics(events, input.model, input.messages, { running: input.running }),
      ),
      '',
    );
  }

  // CAPTURE STATE. A report copied while the agent is still working describes an
  // unfinished run, and every downward-looking signal in it ("no file was written",
  // "no ticket was linked") is premature rather than damning. Saying so once, up
  // front, is the difference between a useful mid-run capture and a misleading one.
  if (input.running) lines.push(midRunNotice(input.activity, Date.now()), '');

  const subagentLines = formatSubagentDiagnostics(input.subagents ?? [], Date.now());
  if (subagentLines.length) lines.push(...subagentLines, '');

  // Structural honesty flags — an assistant turn that CLAIMED a file write or a
  // filed/linked ticket while no such tool call succeeded. Web parity: these ran only
  // in the web triage report, so a VSIX capture of the same failure said nothing.
  if (detectUnbackedWriteClaim(events, input.messages)) lines.push(UNBACKED_WRITE_CLAIM_NOTICE, '');
  if (detectUnbackedTicketClaim(events, input.messages)) lines.push(UNBACKED_TICKET_CLAIM_NOTICE, '');

  return lines;
}

/** The conversation-error block, after the timeline. Empty when there is no error. */
export function buildErrorLines(input: TranscriptInput): string[] {
  return input.error ? ['### Conversation error', truncateMiddle(input.error, MAX_ERROR_CHARS), ''] : [];
}

/** The machine-readable JSON block, LAST. Empty when no report was supplied. */
export function buildJsonLines(input: TranscriptInput): string[] {
  return input.report ? ['', ...formatChatDiagnosticsReportJson(input.report)] : [];
}
