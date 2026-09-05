/**
 * Plain-text transcript serializer for triage.
 *
 * Re-uses the SHARED timeline view-model (`buildTimeline`) so the copied text
 * matches exactly what the <BrainTimeline> renders — user/assistant turns plus
 * the execution trace (thinking, tool input/output, errors). That lets a user
 * copy a "No response" turn together with the underlying tool errors and system
 * output it carried, and paste it somewhere to triage.
 */

import { buildTimeline, formatPayload, formatDuration } from '@seanhogg/builderforce-brain-ui';
import {
  computeBrainDiagnostics,
  detectUnbackedTicketClaim,
  detectUnbackedWriteClaim,
  formatBrainDiagnostics,
  formatBrainProvenance,
  formatChatDiagnostics,
  traceWithPersistedSteps,
  createPayloadBudget,
} from '@seanhogg/builderforce-brain-embedded';
import type {
  BrainMessage,
  BrainRunActivity,
  BrainTraceEvent,
  ChatDiagnosticsData,
  PayloadBudget,
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

function fenced(label: string, payload: string, budget: PayloadBudget, lines: string[]): void {
  if (!payload) return;
  lines.push(`${label}:`, '```', budget.cap(payload, label), '```');
}

/**
 * One clause describing the in-flight step for the mid-run header — "running
 * `search_code` on Builderforce.ai/frontend/src (67s so far, loop step 4)". The
 * elapsed figure is what makes a mid-run capture diagnosable at all: it separates
 * a step that just started from one that has been going for two minutes.
 */
function describeActivity(step: BrainRunActivity): string {
  const elapsed = formatDuration(Math.max(0, Date.now() - step.startedAt));
  const what =
    step.phase === 'tool' ? `running \`${step.label}\`${step.detail ? ` on ${step.detail}` : ''}`
      : step.phase === 'awaiting' ? `PAUSED waiting for the user to approve \`${step.label}\` — nothing advances until they answer`
        : step.phase === 'thinking' ? 'waiting on the model (no token received yet)'
          : step.phase === 'writing' ? 'streaming the reply'
            : step.phase === 'finishing' ? 'doing post-run work (ticket capture / status reconciliation)'
              : 'starting up';
  return `${what} (${elapsed} so far${step.step > 0 ? `, loop step ${step.step}` : ''})`;
}

/** Serialize the live conversation into a Markdown transcript. */
export function buildTranscript(input: TranscriptInput): string {
  const nodes = buildTimeline({ messages: input.messages, trace: input.trace, streamingText: '', isRunning: false });
  // The live `trace` only covers the CURRENT session — a reopened or resumed chat
  // has none of the earlier run's steps in memory, only their durable `role:'tool'`
  // rows. The timeline already reconstructs those; the diagnostics block used the
  // bare trace and so reported `Tool calls: 0` under a transcript listing twenty of
  // them. Both now read the same merged event list.
  const events = traceWithPersistedSteps(input.messages, input.trace);
  // ONE budget for the whole report, spent as the turns are walked, so an early
  // verbose tool dump cannot starve the tail. See `transcriptBudget.ts`.
  const budget = createPayloadBudget({ total: MAX_TOTAL_PAYLOAD_CHARS, perPayload: MAX_PAYLOAD_CHARS });
  const lines: string[] = ['# BuilderForce chat transcript'];

  // Chat + project provenance — a pasted transcript should say WHICH conversation
  // and project it came from, not just the turns.
  if (input.chatTitle || input.chatId != null) {
    const title = input.chatTitle?.trim() || 'Untitled chat';
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
  if (input.running) {
    const step = input.activity;
    const doing = step
      ? `At capture it was ${describeActivity(step)}.`
      : 'No in-flight step was recorded at capture.';
    lines.push(
      `⚠ CAPTURED MID-RUN — the agent was STILL EXECUTING when this report was taken. ${doing} Anything below that reads as "it never did X" may simply be work it had not reached yet; re-copy once the run settles to get a verdict on a finished run.`,
      '',
    );
  }

  // Structural honesty flags — an assistant turn that CLAIMED a file write or a
  // filed/linked ticket while no such tool call succeeded. Web parity: these ran only
  // in the web triage report, so a VSIX capture of the same failure said nothing.
  if (detectUnbackedWriteClaim(events, input.messages)) {
    lines.push('⚠ UNBACKED WRITE CLAIM — an assistant turn claimed it saved/updated a file, but no file-write tool (attachments.write / project_files.save) succeeded in this run. The file was NOT modified.', '');
  }
  if (detectUnbackedTicketClaim(events, input.messages)) {
    lines.push('⚠ UNBACKED TICKET CLAIM — an assistant turn claimed it created/filed/linked a ticket or gap, but no create/link tool (tasks.create / chats.link_ticket / tickets.from_delta) succeeded in this run. Nothing was filed or linked to the chat.', '');
  }

  for (const node of nodes) {
    switch (node.kind) {
      case 'user':
        lines.push('## You');
        if (node.text) lines.push(node.text);
        for (const img of node.images) lines.push(`[image: ${img.name ?? img.url}]`);
        break;
      case 'assistant':
        lines.push(`## ${input.assistantName}`);
        lines.push(node.text || '(no response)');
        break;
      case 'thinking':
        lines.push(`_thought for ${formatDuration(node.durationMs)}_`);
        break;
      case 'tool':
        // The DURATION rides on the heading. A reader scanning the transcript for
        // "where did the time go" should not have to cross-reference the diagnostics
        // block to find the one step that took a minute.
        lines.push(
          `### Tool: ${node.label}${node.durationMs != null ? ` (${formatDuration(node.durationMs)})` : ''}${node.isError ? ' — ERROR' : ''}`,
        );
        fenced('Input', formatPayload(node.args), budget, lines);
        fenced('Output', formatPayload(node.result), budget, lines);
        break;
      case 'error':
        lines.push(`### Error: ${node.label}`, node.message);
        break;
    }
    lines.push('');
  }

  if (input.error) lines.push('### Conversation error', input.error, '');

  // What the budget cost, stated where a reader meets it — so a back reference or an
  // elision is never mistaken for missing data.
  const budgetNote = budget.note();
  if (budgetNote) lines.push(budgetNote, '');

  return `${lines.join('\n').trim()}\n`;
}
