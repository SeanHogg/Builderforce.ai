/**
 * {@link BrainDiagnostics} as report TEXT — the "--- Diagnostics ---" block both copy
 * surfaces (the web triage report and the VS Code transcript) print. Split out of
 * `brainTriage.ts`, which measures; this module only words what was measured, so the
 * two can change independently and neither grows into the other.
 */

import { HISTORY_TOKEN_BUDGET } from '@seanhogg/builderforce-memory/working';
import { formatMemoryUsage, type BrainDiagnostics } from './brainTriage';
import { CONTEXT_PROMPT_PEAK } from './brainVerdict';
import { describeStreamFailure } from './streamFailureDetail';
import { formatRunProgress, runProgressVerdict } from './runProgressReport';
import { formatModelScorecard, formatModelTurnLog } from './modelScorecard';
import { formatRoutingByRole } from './routingByRole';
import { formatStaffingSummary, workFiledNotStaffedVerdict } from './staffingSummary';
import { MAX_TOOL_RESULT_CHARS } from './toolResultBudget';
import { formatBytes } from './runActivity';

/** Human-readable KB. ONE formatter for the package — see `runActivity.ts`. */
const kb = formatBytes;

/**
 * WHAT tripped the context verdict, stated as the evidence it is. The old line claimed
 * "the transcript outgrew the model window" whatever the signal — on a 46k-token peak
 * against a model with a ~1M window, where the true reading is "a large prompt and some
 * results cut to the per-result budget". The reader decides from the numbers.
 */
function contextEvidence(d: BrainDiagnostics): string {
  const parts: string[] = [];
  if (d.promptTokenPeak >= CONTEXT_PROMPT_PEAK) parts.push(`the prompt peaked at ${d.promptTokenPeak.toLocaleString('en-US')} tokens`);
  // NOT "cut before the model saw them": a trim to the per-result budget is the budget
  // working, and calling it a loss turned the most routine line in the report into the
  // headline evidence for a failure that had not happened.
  if (d.truncatedToolResults > 0) parts.push(`${d.truncatedToolResults} tool result(s) were trimmed to the ${toolResultBudgetText()} tool-result budget (by design)`);
  if (d.downgradeEvents > 0) parts.push(`${d.downgradeEvents} turn(s) were served by a smaller model than asked`);
  if (parts.length === 0 && d.largestToolResult) parts.push(`one ${d.largestToolResult.label} result was ${kb(d.largestToolResult.bytes)}`);
  return parts.length ? parts.join('; ') : 'context pressure without a single dominant signal';
}

/** The per-result cap, stated as a reader reads it. Derived, never typed twice. */
function toolResultBudgetText(): string {
  return `${Math.round(MAX_TOOL_RESULT_CHARS / 1000)} KB`;
}

/**
 * The advisory that replaces a verdict when the run showed context pressure and nothing
 * broke. It has to say the numbers (a reader who sees 90k tokens and is told nothing
 * assumes the worst) AND why they are normal, in one line.
 */
function contextPressureLine(d: BrainDiagnostics): string | null {
  if (!d.contextPressureOnly) return null;
  const parts: string[] = [];
  if (d.tokensMeasured && d.promptTokenPeak > 0) parts.push(`prompt peaked at ${d.promptTokenPeak.toLocaleString('en-US')} tokens`);
  if (d.truncatedToolResults > 0) parts.push(`${d.truncatedToolResults} tool result(s) trimmed to the ${toolResultBudgetText()} budget by design`);
  if (!parts.length && d.largestToolResult) parts.push(`one ${d.largestToolResult.label} result was ${kb(d.largestToolResult.bytes)}`);
  return `Context: pressure noted (${parts.join('; ')}) — no turn was cut short by it. The working transcript is held to a ${HISTORY_TOKEN_BUDGET.toLocaleString('en-US')}-token budget on purpose, so a prompt above that figure is the design working, not a fault.`;
}

/** The `healthy` sentence — names recovered failures so a fix-and-retry run reads as completed, not as clean. */
function healthyVerdict(d: BrainDiagnostics): string {
  const recovered = d.recoveredFailures ?? 0;
  return recovered > 0
    ? `Completed — ${recovered} failed step(s) recovered (each was followed by a successful retry of the same command or file). No unrecovered failure, no truncated or empty turns, and no context pressure. Nothing here needs triaging.`
    : 'No failure signal — no errors, no truncated or empty turns, and no context pressure. Nothing here needs triaging.';
}

/** The one-sentence "Likely cause". */
function verdictText(d: BrainDiagnostics): string {
  const evermindAnswers = d.memoryAnswers?.filter((m) => m.source === 'evermind') ?? [];
  switch (d.likelyCause) {
    case 'run-in-progress':
      return 'Run in progress — verdict pending. The capture was taken while the run was still executing, so no cause is named and no "nothing was changed" claim is made; copy the report again once the run settles.';
    case 'memory-answered':
      return `ANSWERED FROM MEMORY — no model ran this turn. The reply was served by the memory-first short-circuit (${(d.memoryAnswers ?? []).map((m) => m.source === 'evermind' ? `the project Evermind SSM${m.projectId != null ? ` of project #${m.projectId}` : ''}${m.version != null ? ` v${m.version}` : ''}` : m.source === 'symbol-index' ? 'the workspace symbol index' : m.source === 'deterministic' ? `the deterministic workspace action ${m.actionId ?? ''}`.trim() : 'the Q&A cache').join(', ')}), so zero turns, zero tokens and zero tool calls is EXPECTED, not a fault. ${evermindAnswers.length ? 'The Evermind SSM cannot call tools and answers only from what it has learned, so it can neither fetch live data nor do work — if the reply was wrong, garbled or stale, that is the cause. Turn Memory off for this chat, or disable inference on that head.' : (d.memoryAnswers ?? []).every((m) => m.source === 'symbol-index') ? 'The request was only "where is X defined?" and the symbol index resolved every name, so the definitions were listed without a model; ask for anything more to reach the model.' : (d.memoryAnswers ?? []).every((m) => m.source === 'symbol-index' || m.source === 'deterministic') ? 'A deterministic workspace action (the PreFetch gate) settled the request without a model; ask for anything more to reach the model.' : 'The reply is a replay of an earlier answer to the same question; ask a differently-worded question to reach the model.'} Switching models changes nothing here.`;
    case 'no-tools-advertised':
      return 'NO TOOLS ADVERTISED — at least one turn was handed ZERO tool definitions, so it could not have emitted a call whatever it wanted to do. This is a catalog/config failure on our side, not a model fault: the gateway MCP catalog (`/llm/v1/mcp/tools`) failed to load, or no actions were registered for this surface. See the "Tools available to the model" line in the Chat diagnostics block for the fetch error. Switching models will not help.';
    case 'tool-not-advertised':
      return `TOOL NOT ADVERTISED — a turn wrote out ${d.narratedUnadvertisedTools.map((n) => `\`${n}\``).join(', ')} as prose while that tool was NOT among the ones it was offered that turn. No model can emit a call for a function it was never given, so this is OUR per-turn tool selection dropping a tool the prompt asked for — not a model that "won't call tools". Fix the selection (pin the tool, or name it in the system prompt so it is force-included) rather than switching models.`;
    case 'tool-calls-not-emitted':
      return 'TOOL CALLS NOT EMITTED — a turn NARRATED a tool call in prose ("I\'ll call the tool…", a bare `builtin_…` name) but the run recorded ZERO tool steps, so nothing executed and the answer never got its data. The tools WERE advertised and the agent loop only runs structured `tool_calls`, so this is a model/provider fault: the model is describing calls instead of emitting them. Try a different model.';
    case 'answered-in-prose':
      return 'ANSWERED IN PROSE — at least one turn was handed tool definitions but replied with text and ZERO tool calls, so nothing ran. The tools were advertised; the model described the work instead of doing it. This is a model/provider fault: try a different model, or pin one that emits structured calls.';
    case 'no-progress':
      return (d.progress && runProgressVerdict(d.progress)) ?? 'NO PROGRESS — the run repeated work without advancing.';
    case 'context-exhaustion':
      return `Likely CONTEXT EXHAUSTION (case A) — ${contextEvidence(d)}.`;
    case 'model-degradation':
      return 'Likely MODEL DEGRADATION (case B) — an Evermind/SSM turn returned empty while tokens stayed low.';
    case 'app-errors-unresolved':
      return `APP STILL BROKEN — every tool call succeeded, but the run's last diagnostics read still reported ${d.unresolvedAppFailures} build/runtime failure(s) in the app it was working on. The tools are fine; the app is not. Read that diagnostics result in the trace below for the error — if it points into a package CDN or the preview runtime rather than the project's own files, the fault is the platform's, and rewriting project files will not fix it.`;
    case 'work-filed-not-staffed':
      return workFiledNotStaffedVerdict(d.staffing);
    case 'healthy':
      return healthyVerdict(d);
    case 'inconclusive':
      return 'Inconclusive — not enough signal to separate context exhaustion from model degradation.';
    default: {
      // A new verdict must be worded here — this fails to compile until it is.
      const unhandled: never = d.likelyCause;
      return `Unrecognised verdict: ${String(unhandled)}`;
    }
  }
}

/**
 * Render {@link BrainDiagnostics} as transcript lines. Shared by both copy
 * surfaces so the "Diagnostics" block is identical on web and in VS Code. Emits
 * a leading `--- Diagnostics ---` header and returns the lines (caller joins).
 */
export function formatBrainDiagnostics(d: BrainDiagnostics): string[] {
  const lines: string[] = ['--- Diagnostics ---', `Likely cause: ${verdictText(d)}`];
  // When the turn/token figures cover only THIS session while the tool figures
  // cover the whole conversation, say so on the line itself — read together
  // without it, "Turns: 2 · Tool calls: 44" looks like corrupt data.
  const scope = d.turnCoveragePartial ? ' (this session)' : '';
  lines.push(`Turns${scope}: ${d.turns} · Tool calls: ${d.toolCalls} · Errors: ${d.errors}${d.recoveredFailures ? ` (${d.recoveredFailures} recovered)` : ''}${d.loopExhausted ? ' · LOOP EXHAUSTED' : ''}`);
  if (d.tokensMeasured) {
    lines.push(
      `Tokens${scope}: prompt peak ${d.promptTokenPeak.toLocaleString()} · last-turn prompt ${d.lastPromptTokens.toLocaleString()} · completion total ${d.completionTokenTotal.toLocaleString()}`,
    );
  } else {
    lines.push('Tokens: not reported by the gateway for this run.');
  }
  if (d.turnCoveragePartial) {
    lines.push(
      'Coverage: tool steps were recovered from this chat\'s durable history, but its earlier TURNS predate durable turn records — so the turn and token counts above describe only the current session, not the whole conversation. Send a new turn to capture a fully-measured run.',
    );
  }
  lines.push(
    `Tool results: ${kb(d.toolResultBytes)} total${d.largestToolResult ? ` · largest ${d.largestToolResult.label} (${kb(d.largestToolResult.bytes)})` : ''}${d.truncatedToolResults ? ` · ${d.truncatedToolResults} trimmed to the ${toolResultBudgetText()} per-result budget (by design)` : ''}${d.pagedReadWindows ? ` · ${d.pagedReadWindows} read_file window(s) paged (continued by offset, not lost)` : ''}`,
  );
  // Pressure without a consequence. Stated here, next to the numbers that produced it,
  // so a reader meets the explanation in the same breath as the figure.
  const pressure = contextPressureLine(d);
  if (pressure) lines.push(pressure);
  // Repetition / reach / effect / timing. Placed directly under the tool-result
  // sizes because they answer the question those sizes raise: 102 KB of tool output
  // across 26 calls is either research or a loop, and only these lines say which.
  lines.push(...(d.progress ? formatRunProgress(d.progress, { running: d.running }) : []));
  // Filed vs staffed. Sits beside progress because it answers the same class of question
  // — "did anything actually come of this?" — for the half progress cannot see: work that
  // was created perfectly and handed to nobody. See `staffingSummary.ts`.
  if (d.memoryUsage) lines.push(formatMemoryUsage(d.memoryUsage));
  lines.push(...(d.staffing ? formatStaffingSummary(d.staffing, { sessionShipped: d.sessionShipped }) : []));
  // WHICH steps failed. `Errors: 1` alone forced a reader to scroll the transcript
  // hunting for the failure; naming it is the difference between a number and a lead.
  if (d.errorSteps?.length) {
    for (const e of d.errorSteps) {
      lines.push(
        `Failed step: ${e.label}${e.model ? ` on ${e.model}` : ''}${e.recovered ? ' (recovered by a later successful retry)' : ''} — ${e.message}`
          + (e.requiredRole || e.callerRole
            ? ` — requires ${e.requiredRole ?? 'unknown'}, caller is ${e.callerRole ?? 'unknown'}${e.remediation ? `; ${e.remediation}` : ''}`
            : ''),
      );
      if (e.failure) lines.push(`  ${describeStreamFailure(e.failure)}`);
    }
    if (d.errors > d.errorSteps.length) lines.push(`(+${d.errors - d.errorSteps.length} earlier failure(s) not listed)`);
  }
  // What the model could actually CALL, per turn — not the registry-wide total. A run
  // whose turns saw 0 tools and a run whose turns saw 64 and ignored them used to render
  // identically, which is how "try a different model" became the standing advice for a
  // fault that no model change could fix.
  if (d.advertisedToolsLastTurn != null) {
    const range =
      d.advertisedToolsMin != null && d.advertisedToolsMin !== d.advertisedToolsLastTurn
        ? `${d.advertisedToolsMin}–${d.advertisedToolsLastTurn}`
        : `${d.advertisedToolsLastTurn}`;
    lines.push(
      `Tools advertised per turn: ${range}${d.catalogTools ? ` (of ${d.catalogTools} in the catalog)` : ''}${d.advertisedToolsMin === 0 ? ' · ⚠ a turn was offered NONE' : ''}`,
    );
  } else {
    lines.push('Tools advertised per turn: not recorded (this run predates per-turn tool accounting).');
  }
  if (d.narratedUnadvertisedTools.length) {
    lines.push(`Narrated but never advertised: ${d.narratedUnadvertisedTools.join(', ')} — the model was told to call a tool it was not given.`);
  }
  // How the loop FOUGHT the stall. Without these a report showing nine turns and zero
  // tool calls reads as though nothing intervened, when in fact the loop re-prompted
  // three times and swapped models twice before giving up.
  if (d.stallRecoveries > 0 || d.modelFailovers > 0 || d.stallUnrecovered) {
    lines.push(
      `Stall handling: ${d.stallRecoveries} re-prompt(s) · ${d.modelFailovers} model failover(s)${d.stallUnrecovered
        ? ' · GAVE UP (the stall survived every attempt)'
        : d.stallRecovered
          ? ' · recovered'
          : ' · NOT recovered (no tool ran after the last re-prompt — the run ended on a turn the stall detector accepted as an answer)'}`,
    );
  }
  // A turn whose stream broke is retried ONCE on another model; a second break ends the run.
  if (d.streamRetries?.length) {
    lines.push(`Stream retries: ${d.streamRetries.length} — ${d.streamRetries.join(', ')} broke mid-turn and the turn was retried on another model (one retry per turn).`);
  }
  // WHICH model did what. "Models used: a, b" cannot say that one of them never called
  // a tool, or that its calls were written in markup nothing parsed; these lines can.
  lines.push(...formatModelScorecard(d.modelScores ?? []));
  lines.push(...formatRoutingByRole(d.routing));
  // Ordered per-output attribution — the scorecard aggregates; this lists each
  // llm.complete so "which outputs were Grok rambling" is answerable without counting.
  // Clearer diagnostics do NOT fix Grok tool calling: production API must include the
  // Responses adapter deploy (a client ahead of the gateway still lacks it).
  lines.push(...formatModelTurnLog(d.modelTurns ?? []));
  if (d.downgradeEvents > 0) lines.push(`Model downgrades: ${d.downgradeEvents} turn(s) answered by a different model than requested (gateway failover).`);
  if (d.emptyOrLengthFinishes > 0) lines.push(`Degenerate turns: ${d.emptyOrLengthFinishes} ended on \`length\` or returned empty text.`);
  if (d.evermindUsed.length) lines.push(`Evermind/SSM answered: ${d.evermindUsed.join(', ')}`);
  // Always reported when it happened, even on a mixed run where the model handled the
  // other turns — otherwise a memory-answered reply is invisible in the numbers and the
  // reader attributes its (tool-less, token-less) shape to the model.
  if (d.memoryAnswers?.length) {
    lines.push(
      `Answered from memory (LLM skipped): ${d.memoryAnswers.length} turn(s) — `
      + d.memoryAnswers
        .map((m) => m.source === 'evermind'
          ? `Evermind SSM${m.projectId != null ? ` (project #${m.projectId}` : ''}${m.version != null ? `${m.projectId != null ? ', ' : ' ('}v${m.version}` : ''}${m.projectId != null || m.version != null ? ')' : ''}`
          : m.source === 'symbol-index' ? 'symbol index' : m.source === 'deterministic' ? `workspace action ${m.actionId ?? ''}`.trim() : 'Q&A cache')
        .join(', '),
    );
  }
  return lines;
}
