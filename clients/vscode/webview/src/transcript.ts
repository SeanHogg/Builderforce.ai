/**
 * Plain-text transcript serializer for triage.
 *
 * Re-uses the SHARED timeline view-model (`buildTimeline`) so the copied text
 * matches exactly what the <BrainTimeline> renders — user/assistant turns plus
 * the execution trace (thinking, tool input/output, errors). That lets a user
 * copy a "No response" turn together with the underlying tool errors and system
 * output it carried, and paste it somewhere to triage.
 */

import { buildTimeline, formatDuration, strandedReplyKey, toolStepView } from '@seanhogg/builderforce-brain-ui';
import { splitReasoningSegments } from '@builderforce/agent-loop';
import {
  formatAssistantTranscriptHeading,
  traceWithPersistedSteps,
  createPayloadBudget,
  cutMiddleToFit,
  PASTE_SAFE_REPORT_CHARS,
} from '@seanhogg/builderforce-brain-embedded';
import { buildErrorLines, buildHeadLines, buildJsonLines } from './transcriptSections';
import type {
  BrainMessage,
  BrainRunActivity,
  BrainTraceEvent,
  ChatDiagnosticsData,
  ChatDiagnosticsReport,
  PayloadBudget,
  SubagentDiagnosticsInput,
} from '@seanhogg/builderforce-brain-embedded';

export interface TranscriptInput {
  messages: BrainMessage[];
  trace: BrainTraceEvent[];
  assistantName: string;
  model?: string;
  error?: string | null;
  /** The project this chat is associated with (name + id), for provenance. */
  project?: { id: number; name: string } | null;
  /** The chat's title and server id, so a pasted transcript is traceable. */
  chatTitle?: string;
  chatId?: number | null;
  /** Gathered chat identity, ACCOUNT posture and Evermind wiring state — rendered as a
   *  "Chat diagnostics" block so a pasted report answers "what STATE was this chat in?"
   *  (plan + billing + month-to-date quota + model entitlement, project, tenant, Evermind
   *  head, learn-gate outcome, agents, linked tickets), not just the turns. */
  diagnostics?: ChatDiagnosticsData;
  /**
   * The SAME capture as one versioned JSON object — the copy that is also persisted with
   * the chat. Appended at the very end of the report; see the note where it is written.
   */
  report?: ChatDiagnosticsReport;
  /**
   * True when the run was STILL EXECUTING at capture time. The trace cannot know
   * this, and it changes how every "and then nothing happened" signal must be read:
   * a chat copied mid-run has not declined to finish the work, it has not finished
   * it YET. Stated in the header AND fed to the diagnostics verdict.
   */
  running?: boolean;
  /**
   * The in-flight step at capture time — which tool, on what, since when. The single
   * most useful fact when the complaint is "it has been sitting there for a minute",
   * and one the settled trace can never carry.
   */
  activity?: BrainRunActivity | null;
  /** Every sub-agent this chat's runs spawned this session, each read from its OWN run —
   *  the owner's trace shows only that it waited on them. */
  subagents?: SubagentDiagnosticsInput[];
}

/** True when there is something worth copying (any turn, trace step, or error). */
export function hasTranscriptContent(input: { messages: unknown[]; trace: unknown[]; error?: string | null }): boolean {
  return input.messages.length > 0 || input.trace.length > 0 || !!input.error;
}

/**
 * Ceiling for any ONE tool Input/Output block while the budget is healthy. A single
 * verbose result (`builtin_llm_health` dumps ~40 models of JSON, ~15 KB) would
 * otherwise crowd out everything after it. Generous, so real content survives; the
 * full result is on the live timeline either way.
 */
const MAX_PAYLOAD_CHARS = 4_000;

/**
 * Ceiling for ALL payloads TOGETHER. Per-payload capping alone was not enough: a
 * 26-call run stayed inside the 4 KB cap on every single block and still assembled a
 * report the paste target cut off at 50,000 characters — from the END, which is exactly
 * where the failure being triaged lives. The shared budget decays the per-payload cap
 * as the pool drains, and charges nothing for a byte-identical repeat, so the tail of
 * the report survives. See `transcriptBudget.ts`.
 */
const MAX_TOTAL_PAYLOAD_CHARS = 34_000;
// NOTE: 34,000 is only the UPPER bound of the timeline pool. The pool actually used is
// min(34,000, max(MIN_TIMELINE_BUDGET_CHARS, 48,000 − fixed sections − nodes × 120)), so
// a big header/JSON shrinks the timeline instead of the report overflowing the paste limit.

/** Smallest timeline budget, however large the fixed sections are — the hard cut backs it. */
const MIN_TIMELINE_BUDGET_CHARS = 6_000;

/** Room reserved for the budget note, which is only known after the timeline is walked. */
const BUDGET_NOTE_RESERVE_CHARS = 400;

/** Rough per-node cost of headings and separators the budget does not charge. */
const NODE_OVERHEAD_CHARS = 120;

/** Per-item ceilings for message text. Replies carry the answer; reasoning is secondary. */
const MAX_REPLY_CHARS = 6_000;
const MAX_USER_TEXT_CHARS = 3_000;
const MAX_REASONING_CHARS = 1_500;

/** Text shorter than this is not worth charging (or back-referencing: "continue" twice). */
const MIN_CHARGED_TEXT_CHARS = 240;

function fenced(label: string, payload: string, budget: PayloadBudget, lines: string[]): void {
  if (!payload) return;
  lines.push(`${label}:`, '```', budget.cap(payload, label), '```');
}

/** Charge a message body against the shared budget; short text passes through. */
function chargeText(text: string, label: string, budget: PayloadBudget, maxChars: number): string {
  return text.length < MIN_CHARGED_TEXT_CHARS ? text : budget.cap(text, label, maxChars);
}


/** Serialize the live conversation into a Markdown transcript. */
export function buildTranscript(input: TranscriptInput): string {
  const nodes = buildTimeline({ messages: input.messages, trace: input.trace, streamingText: '', isRunning: false });
  // The reply the transcript surface RESCUED from its own reasoning, if any — read from
  // the same predicate the UI renders with, so this report can never describe reasoning
  // as hidden when the reader was in fact shown it as the reply.
  const stranded = strandedReplyKey(nodes, false);
  // The live `trace` only covers the CURRENT session — a reopened or resumed chat
  // has none of the earlier run's steps in memory, only their durable `role:'tool'`
  // rows. The timeline already reconstructs those; the diagnostics block used the
  // bare trace and so reported `Tool calls: 0` under a transcript listing twenty of
  // them. Both now read the same merged event list.
  const events = traceWithPersistedSteps(input.messages, input.trace);
  // The FIXED sections (header, diagnostics, error, JSON) are assembled first and
  // measured: the timeline gets what is left of the whole-report ceiling, so the report
  // as a whole — not just its tool payloads — stays under the paste limit.
  const headLines = buildHeadLines(input, events);
  const errorLines = buildErrorLines(input);
  const jsonLines = buildJsonLines(input);
  const fixedChars = [...headLines, ...errorLines, ...jsonLines].join('\n').length + BUDGET_NOTE_RESERVE_CHARS;
  const timelineBudget = Math.min(
    MAX_TOTAL_PAYLOAD_CHARS,
    Math.max(
      MIN_TIMELINE_BUDGET_CHARS,
      PASTE_SAFE_REPORT_CHARS - fixedChars - nodes.length * NODE_OVERHEAD_CHARS,
    ),
  );
  // ONE budget for the timeline, spent as the turns are walked, so an early
  // verbose tool dump cannot starve the tail. See `transcriptBudget.ts`.
  const budget = createPayloadBudget({ total: timelineBudget, perPayload: MAX_PAYLOAD_CHARS });
  const lines: string[] = [];

  for (const node of nodes) {
    switch (node.kind) {
      case 'user':
        lines.push('## You');
        if (node.text) lines.push(chargeText(node.text, 'user message', budget, MAX_USER_TEXT_CHARS));
        for (const img of node.images) lines.push(`[image: ${img.name ?? img.url}]`);
        break;
      case 'assistant': {
        // Stamp the resolved model on every assistant block so a multi-model paste
        // attributes each output — not only the aggregate "Models used" / "Per model" lines.
        lines.push(formatAssistantTranscriptHeading(input.assistantName, node.message));
        // Split the vendor's `<think>` blocks exactly as the UI does, so the report
        // shows what the USER saw. Dumping raw control tags made a reply look
        // mangled in the report when it had rendered fine, and — worse — hid the
        // opposite case: a model that seals its answer inside the block ships the
        // user a fragment, which is only visible once the two are separated.
        const parts = splitReasoningSegments(node.text || '');
        const answer = parts.filter((p) => p.kind === 'answer').map((p) => p.content).join('\n\n').trim();
        const thoughts = parts.filter((p) => p.kind === 'thought').map((p) => p.content).join('\n\n').trim();
        // This turn ended the run from inside its `<think>` block, so the surface showed
        // the reasoning AS the reply. The report says so, rather than printing
        // "(no response)" over a turn the reader could in fact read.
        const rescued = node.key === stranded ? thoughts : '';
        if (rescued) {
          lines.push(
            "_(reply recovered from the model's reasoning — the turn ended without a separate reply)_",
            '',
            chargeText(rescued, 'assistant reply', budget, MAX_REPLY_CHARS),
          );
        } else {
          // A turn that only REASONED (then called a tool) rendered as one collapsed
          // "Thought" line, not as an empty reply — say that, rather than "(no
          // response)" over every step of a working run.
          lines.push(
            answer
              ? chargeText(answer, 'assistant reply', budget, MAX_REPLY_CHARS)
              : (thoughts ? '_(reasoning only — no reply text this turn)_' : '(no response)'),
          );
          // Reasoning is kept, clearly marked as not-the-reply — it is often where a
          // failing turn explains itself. Secondary, so it takes a lower per-item cap.
          if (thoughts) {
            const shown = chargeText(thoughts, 'model reasoning', budget, MAX_REASONING_CHARS);
            lines.push('', `<details><summary>model reasoning (not shown to the user)</summary>\n\n${shown}\n\n</details>`);
          }
        }
        break;
      }
      case 'thinking':
        lines.push(`_thought for ${formatDuration(node.durationMs)}_`);
        break;
      case 'tool': {
        // The DURATION rides on the heading. A reader scanning the transcript for
        // "where did the time go" should not have to cross-reference the diagnostics
        // block to find the one step that took a minute.
        lines.push(
          `### Tool: ${node.label}${node.durationMs != null ? ` (${formatDuration(node.durationMs)})` : ''}${node.isError ? ' — ERROR' : ''}`,
        );
        // The SAME view-model the timeline renders from, so a pasted report shows a
        // shell step the way the reader saw it — the command line and what it printed,
        // not `{"command":…}` above `{"ok":true,"stdout":…}`. The residual panels below
        // still carry anything the terminal view did not account for.
        const view = toolStepView(node);
        if (view.command) {
          fenced('Command', `$ ${view.command.command}`, budget, lines);
          fenced(
            view.command.exitCode != null && view.command.exitCode !== 0
              ? `Output (exit ${view.command.exitCode})`
              : 'Output',
            view.command.output || '(no output)',
            budget,
            lines,
          );
        }
        fenced('Input', view.argsText, budget, lines);
        fenced('Output', view.resultText, budget, lines);
        break;
      }
      case 'error':
        lines.push(`### Error: ${node.label}`, node.message);
        break;
      case 'compacted':
        // A fold is triage-relevant: everything above it reached the model only as this note.
        lines.push(`### Context auto-compacted (${node.count} step(s))`);
        if (node.note) fenced('Memory note', node.note, budget, lines);
        break;
    }
    lines.push('');
  }

  // Tail: the conversation error, what the budget cost (stated where a reader meets it,
  // so a back reference or an elision is never mistaken for missing data), then the
  // machine-readable JSON LAST. The JSON is never trimmed (a half-elided object does not
  // parse) — it is compacted and, past its own cap, has whole fields elided; see
  // `formatChatDiagnosticsReportJson`. It is counted in `fixedChars` above instead.
  const tail = [...errorLines];
  const budgetNote = budget.note();
  if (budgetNote) tail.push(budgetNote, '');
  tail.push(...jsonLines);

  // Hard guarantee: if the report is somehow still over the ceiling, cut the MIDDLE of
  // the timeline — the head diagnostics and the tail (last turns, note, JSON) survive.
  const report = cutMiddleToFit(
    headLines.join('\n'),
    lines.join('\n'),
    tail.join('\n'),
    PASTE_SAFE_REPORT_CHARS,
  );
  return `${report.trim()}\n`;
}
