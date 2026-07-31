/**
 * managerChatDiagnostics — turn an "Ask the manager" conversation into ONE pasteable
 * report: the transcript, AND what the manager actually did to produce it.
 *
 * ── WHY THE TRANSCRIPT ALONE IS NOT A DIAGNOSTIC ─────────────────────────────────
 * The failure that motivated this file reads, in the transcript, like a model being
 * unhelpful:
 *
 *     Manager: "The required tools have not returned results yet, so I have no new data
 *               on digest, decisions, census or policy for project 11."
 *
 * From the transcript that is indistinguishable from four different bugs — the model
 * never emitted a tool call; it called tools that all errored; it called tools that
 * returned empty; or it was never given those tools at all. They have completely
 * different fixes, and a screenshot of the conversation cannot separate them. (The real
 * cause was the fourth: the system prompt named tools by catalog id, so the names matched
 * nothing in the model's tool list.)
 *
 * So this pairs each reply with the TOOL TRACE the server persisted for it — every call,
 * its arguments, whether it errored, how long it took — plus the LLM-turn rows that
 * record `toolCalls: 0`, which is the only positive evidence that a model narrated
 * instead of acting. The findings block names which of the four it was, first.
 *
 * PURE — no clock, no fetch, no DOM, no i18n (see {@link ./diagnosticsReport} for why the
 * body is deliberately locale-independent English while the button around it is not).
 */
import {
  claimsMissingToolData,
  announcesUntakenAction,
  toolNamesMentionedIn,
  catalogToolNamesMentionedIn,
} from '@seanhogg/builderforce-brain-embedded';
import type { BrainChatTraceRow, BrainMessage, ManagerChatHandle } from './builderforceApi';
import {
  capText,
  environmentLines,
  jsonAppendix,
  line,
  windowRows,
  REPORT_BUDGET_CHARS,
  type DiagnosticsContext,
} from './diagnosticsReport';
import type { FindingSeverity, ManagerFinding } from './managerDiagnostics';

/** Message window: a long accountability thread is head + tail, never silently cut. */
export const MESSAGE_WINDOW_HEAD = 6;
export const MESSAGE_WINDOW_TAIL = 24;
/** Trace window. One reply can produce a dozen rows; a thread can produce hundreds. */
export const TRACE_WINDOW_HEAD = 10;
export const TRACE_WINDOW_TAIL = 40;

/** Everything the report needs, already gathered by the surface (pure in). */
export interface ManagerChatDiagnosticsInput {
  projectId: number;
  /** Which chat + who answers in it. `null` when the handle itself could not be read. */
  handle: ManagerChatHandle | null;
  handleError?: string | null;
  messages: BrainMessage[];
  messagesError?: string | null;
  /**
   * The persisted tool trace. `null` when the read failed — STATED, never rendered as an
   * empty trace, which would fire the "the manager never called anything" finding off a
   * network error and send the reader after a bug that is not there.
   */
  trace: BrainChatTraceRow[] | null;
  traceError?: string | null;
}

/** Read the agent display name a reply was attributed with (`metadata.authoredBy`). */
function authorOf(message: BrainMessage): string | null {
  if (!message.metadata) return null;
  try {
    const parsed = JSON.parse(message.metadata) as { authoredBy?: { name?: string } };
    return parsed.authoredBy?.name ?? null;
  } catch {
    return null;
  }
}

/** Read the model provenance a reply carries (`metadata.provenance`). */
export function provenanceOf(message: BrainMessage): { model?: string; account?: string; vendor?: string } | null {
  if (!message.metadata) return null;
  try {
    const parsed = JSON.parse(message.metadata) as { provenance?: { model?: string; account?: string; vendor?: string } };
    return parsed.provenance ?? null;
  } catch {
    return null;
  }
}

/** What the trace says happened, rolled up. PURE. */
export interface TraceRollup {
  /** Rows of kind 'tool' — an actual platform call. */
  toolCalls: number;
  toolErrors: number;
  /** Rows of kind 'llm' — one per model turn in the reply loop. */
  modelTurns: number;
  /** Model turns that emitted ZERO tool calls. */
  turnsWithoutTools: number;
  /** Tool ids called, most frequent first. */
  byTool: Array<{ tool: string; count: number; errors: number }>;
  /** How many tools the model was actually offered, per the newest llm row that says. */
  advertisedTools: number | null;
  /**
   * Distinct models that actually ran, in first-seen order.
   *
   * Load-bearing for the stall findings: the reply loop is SUPPOSED to abandon a model
   * that will not emit tool calls and try another. One model across every turn means the
   * failover did not happen — a different (and worse) fact than "two models both refused",
   * and the finding used to assert the second while the trace showed the first.
   */
  models: string[];
  /** `failover` rows — the loop deciding to switch models. Zero with `models.length === 1`
   *  is positive evidence the run never left its first model. */
  failovers: number;
}

/** Row shapes the server writes into `result` for each trace kind. */
interface LlmTraceResult { toolCalls?: number; advertisedTools?: number; finishReason?: string; toolNames?: string[] }

function readLlmResult(row: BrainChatTraceRow): LlmTraceResult | null {
  const r = row.resultJson;
  if (r == null) return null;
  try {
    const parsed: unknown = typeof r === 'string' ? JSON.parse(r) : r;
    return parsed && typeof parsed === 'object' ? (parsed as LlmTraceResult) : null;
  } catch {
    return null;
  }
}

export function summarizeTrace(trace: readonly BrainChatTraceRow[]): TraceRollup {
  const byTool = new Map<string, { count: number; errors: number }>();
  const models: string[] = [];
  const out: TraceRollup = {
    toolCalls: 0, toolErrors: 0, modelTurns: 0, turnsWithoutTools: 0,
    byTool: [], advertisedTools: null, models, failovers: 0,
  };
  for (const row of trace) {
    if (row.kind === 'failover') { out.failovers += 1; continue; }
    if (row.kind === 'tool') {
      out.toolCalls += 1;
      const key = row.label || '(unlabelled)';
      const b = byTool.get(key) ?? { count: 0, errors: 0 };
      b.count += 1;
      if (row.isError) { b.errors += 1; out.toolErrors += 1; }
      byTool.set(key, b);
      continue;
    }
    if (row.kind !== 'llm') continue;
    out.modelTurns += 1;
    if (row.label && !models.includes(row.label)) models.push(row.label);
    const parsed = readLlmResult(row);
    if (parsed?.toolCalls === 0) out.turnsWithoutTools += 1;
    if (typeof parsed?.advertisedTools === 'number') out.advertisedTools = parsed.advertisedTools;
  }
  out.byTool = [...byTool.entries()]
    .map(([tool, b]) => ({ tool, count: b.count, errors: b.errors }))
    .sort((a, b) => b.count - a.count);
  return out;
}

/**
 * Is this reply narrating tools instead of calling them?
 *
 * Delegates to `@builderforce/agent-stall` — the SAME predicates the reply loop recovers
 * on. This file used to carry its own regex list, and a report whose detector disagrees
 * with the loop's describes a different conversation than the one the loop saw: a reply
 * the loop re-prompted three times could read as a clean answer here, and a reply the
 * loop shipped as final could be flagged as a stall. One definition, two readers.
 */
export function looksLikeToolNarration(text: string): boolean {
  return claimsMissingToolData(text) || announcesUntakenAction(text);
}

/**
 * WHICH NAMING the narration used — the discriminator between two bugs that produce
 * identical transcripts (see `catalogToolNamesMentionedIn` for the full argument).
 *
 * `catalog` — the reply recites `manager.digest`: a name that appears nowhere in the
 *   model's tool list, so something handed it a string it could never act on.
 * `advertised` — the reply recites `builtin_manager_digest`: it was told the RIGHT name
 *   and still would not emit a call. Nothing about the prompt or the catalog is wrong.
 * `none` — it complained about tools without naming any; only the trace can say more.
 *
 * `advertised` wins a tie: a reply that names both was reading a correct tool list.
 */
export type NarratedToolNaming = 'advertised' | 'catalog' | 'none';

export function narratedToolNaming(texts: readonly string[]): NarratedToolNaming {
  const joined = texts.join('\n');
  if (toolNamesMentionedIn(joined).length > 0) return 'advertised';
  return catalogToolNamesMentionedIn(joined).length > 0 ? 'catalog' : 'none';
}

/**
 * Name the likely causes, ranked. Reuses the manager report's finding shape so both
 * reports read identically and a reader learns one format, not two.
 */
export function managerChatFindings(input: ManagerChatDiagnosticsInput): ManagerFinding[] {
  const critical: ManagerFinding[] = [];
  const warning: ManagerFinding[] = [];
  const info: ManagerFinding[] = [];
  const push = (severity: FindingSeverity, code: string, text: string) =>
    (severity === 'critical' ? critical : severity === 'warning' ? warning : info).push({ severity, code, text });

  const replies = input.messages.filter((m) => m.role === 'assistant');

  if (input.handle == null) {
    push('critical', 'chat_unavailable',
      `The manager chat could not be resolved${input.handleError ? ` (${input.handleError})` : ''}, so nothing below describes a live conversation.`);
  } else if (!input.handle.agentRef) {
    push('critical', 'no_manager_agent',
      'No manager agent is resolvable for this project, so nothing can answer in this chat. Designate a manager under Policy, or check that the workspace has its built-in Manager agent provisioned.');
  }

  if (input.trace == null) {
    push('warning', 'trace_unavailable',
      `The tool trace could not be loaded${input.traceError ? ` (${input.traceError})` : ''}. Without it this report cannot tell a manager that never called a tool from one whose calls all failed — the transcript looks identical either way.`);
    return [...critical, ...warning, ...info];
  }

  const roll = summarizeTrace(input.trace);
  const narrating = replies.filter((m) => looksLikeToolNarration(m.content));

  // THE finding this report exists for. A reply that describes the calls it needs, from a
  // turn that emitted none, is not the model being unhelpful — it could not find the tools
  // it was told to call, or it was never given them.
  if (narrating.length > 0 && roll.toolCalls === 0) {
    push('critical', 'tools_narrated_never_called',
      `${narrating.length} repl${narrating.length === 1 ? 'y' : 'ies'} describe the tools the manager needs while the trace records ZERO tool calls${roll.modelTurns > 0 ? ` across ${roll.modelTurns} model turn${roll.modelTurns === 1 ? '' : 's'}` : ''}. The manager is naming tools it never invoked. The cause is a NAME MISMATCH: something instructed it to call a tool by its catalog id (manager.digest) while the model is advertised a transformed name (builtin_manager_digest), so the instruction points at nothing and the model narrates instead. Two places say that, and the second is the one that hides: the CODE that builds the turn (guarded by check-prompt-tool-names + agentReplyPrompt.test), and the agent's PERSISTED PERSONA — ide_agents.bio is compiled straight into the system prompt, was written once per tenant by a migration, and is not corrected by any deploy (this exact row recited dead ids for a full release after the code was fixed; see migration 0379). If the code guards are green, read the answering agent's bio${roll.advertisedTools != null ? ` (this turn advertised ${roll.advertisedTools} tools)` : ''}.`);
  } else if (roll.toolCalls === 0 && replies.length > 0 && roll.modelTurns > 0) {
    push('critical', 'no_tools_called',
      `The manager produced ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'} across ${roll.modelTurns} model turn${roll.modelTurns === 1 ? '' : 's'} and called NO tools at all${roll.advertisedTools != null ? `, despite being advertised ${roll.advertisedTools}` : ''}. Every accountability answer it gave is therefore ungrounded — it did not read the digest, the decisions, the census or the policy.`);
  } else if (narrating.length > 0) {
    push('warning', 'tools_narrated',
      `${narrating.length} repl${narrating.length === 1 ? 'y' : 'ies'} talk about tools rather than reporting results, although ${roll.toolCalls} tool call${roll.toolCalls === 1 ? '' : 's'} did run. The calls may be returning empty — check their results in the trace below before assuming the model is at fault.`);
  }

  if (roll.toolErrors > 0) {
    const failing = roll.byTool.filter((t) => t.errors > 0);
    push('critical', 'tool_errors',
      `${roll.toolErrors} tool call${roll.toolErrors === 1 ? '' : 's'} FAILED: ${failing.map((t) => `${t.tool} ${t.errors}/${t.count}`).join(', ')}. A failed call is fed back to the model as a tool result, so the manager may have answered around it rather than reporting it — read the error text in the trace below.`);
  }

  // A turn that emitted no tool calls is normal ONCE (the final synthesis). Every turn
  // doing it, with tools available, is the stall.
  if (roll.modelTurns > 1 && roll.turnsWithoutTools === roll.modelTurns && roll.toolCalls === 0) {
    push('warning', 'every_turn_toolless',
      `All ${roll.modelTurns} model turns ended without emitting a tool call. The reply loop's stall recovery re-prompts and then fails over to another model; that this still produced nothing suggests the tools are unusable to the model rather than that one model was weak.`);
  }

  if (replies.length > 0 && input.trace.length === 0) {
    push('info', 'trace_empty',
      'The trace is empty. Replies produced before server-side trace capture shipped carry no rows — ask the manager one more question and re-capture to get a trace for it.');
  }

  const models = new Set(
    input.messages.map((m) => provenanceOf(m)?.model).filter((m): m is string => !!m),
  );
  if (models.size > 0) {
    push('info', 'models_used',
      `Replies were served by: ${[...models].join(', ')}. A weak model that cannot tool-call produces the same empty answers as a broken tool list — the distinction is whether the trace shows calls being attempted.`);
  }

  return [...critical, ...warning, ...info];
}

// ── section renderers ───────────────────────────────────────────────────────

function formatTranscript(messages: readonly BrainMessage[]): string[] {
  if (messages.length === 0) return ['(no messages — nothing has been asked yet)'];
  const rendered = messages.map((m, i) => {
    const who = m.role === 'user' ? 'You' : authorOf(m) ?? 'assistant';
    const prov = provenanceOf(m);
    const head = `${String(i + 1).padStart(3, ' ')}. [${m.role}] ${who}  seq=${m.seq}  at=${m.createdAt}`
      + (prov?.model ? `  model=${prov.model}${prov.account ? ` account=${prov.account}` : ''}` : '');
    // The message body is capped generously: a manager's answer IS the evidence here, and
    // trimming it to a headline would defeat the report.
    return `${head}\n     ${capText(m.content.replace(/\n/g, '\n     '), 2000)}`;
  });
  return windowRows(rendered, {
    head: MESSAGE_WINDOW_HEAD,
    tail: MESSAGE_WINDOW_TAIL,
    note: (elided) => [
      `     … ${elided} message${elided === 1 ? '' : 's'} elided from the MIDDLE of the thread. The opening`,
      '       questions and the most recent exchange are both kept — a conversation is diagnosed',
      '       from how it started and how it is going now, not from its middle.',
    ],
  });
}

function formatTrace(trace: readonly BrainChatTraceRow[], roll: TraceRollup): string[] {
  const out: string[] = [];
  out.push(line('tool calls', roll.toolCalls));
  out.push(line('tool calls that FAILED', roll.toolErrors));
  out.push(line('model turns', roll.modelTurns));
  out.push(line('model turns that emitted NO tool call', roll.turnsWithoutTools));
  out.push(line('tools advertised to the model', roll.advertisedTools));
  out.push('');
  out.push('by tool:');
  if (roll.byTool.length === 0) {
    out.push('  (none — the manager called nothing)');
  }
  for (const t of roll.byTool) {
    out.push(`  ${t.tool}: ${t.count}${t.errors > 0 ? `  FAILED=${t.errors}` : ''}`);
  }
  out.push('');
  if (trace.length === 0) return [...out, '(no trace rows)'];

  const rendered = trace.map((r, i) => {
    const head = `${String(i + 1).padStart(3, ' ')}. [${r.kind}] ${r.label ?? '—'}`
      + `  turn=${r.turnSeq ?? '—'}${r.isError ? '  ERROR' : ''}`
      + `${r.durationMs != null ? `  ${r.durationMs}ms` : ''}  at=${r.createdAt}`;
    const parts = [head];
    if (r.argsJson) parts.push(`     args:   ${capText(String(r.argsJson), 600)}`);
    if (r.resultJson) parts.push(`     result: ${capText(String(r.resultJson), 900)}`);
    return parts.join('\n');
  });
  out.push(...windowRows(rendered, {
    head: TRACE_WINDOW_HEAD,
    tail: TRACE_WINDOW_TAIL,
    note: (elided) => [
      `     … ${elided} trace row${elided === 1 ? '' : 's'} elided from the MIDDLE. The rollup above counts`,
      '       every row; re-fetch GET /api/brain/chats/<id>/trace for the untrimmed list.',
    ],
  }));
  return out;
}

/**
 * Build the full "Ask the manager" diagnostics report.
 *
 * Order: environment → findings → who answers → transcript → tool trace → raw JSON.
 * The trace sits BELOW the transcript because the transcript is what the reader already
 * saw and will describe; the trace is the evidence that explains it.
 */
export function buildManagerChatDiagnosticsReport(
  input: ManagerChatDiagnosticsInput,
  ctx: DiagnosticsContext,
): string {
  const out: string[] = [];
  out.push('=== BUILDERFORCE — ASK THE MANAGER (CHAT DIAGNOSTICS) ===');
  out.push('');
  out.push(...environmentLines(ctx, [
    ['projectId', input.projectId],
    ['chatId', input.handle?.chatId ?? '(unresolved)'],
  ]));
  out.push('');

  const findings = managerChatFindings(input);
  out.push(`-- Findings (${findings.length}) --`);
  out.push('Derived from the transcript AND the tool trace, most actionable first. A reply that');
  out.push('says it lacks data means four different things depending on what the trace shows;');
  out.push('these separate them.');
  if (findings.length === 0) {
    out.push('(nothing detected — the manager called its tools and answered from them)');
  }
  for (const f of findings) out.push(`[${f.severity}] ${f.code}: ${f.text}`);
  out.push('');

  out.push('-- Who answers --');
  out.push(line('agentRef', input.handle?.agentRef ?? null));
  out.push(line('agentName', input.handle?.agentName ?? null));
  out.push(line('designated manager (vs the built-in Manager agent)', input.handle?.designated ?? null));
  out.push('');

  out.push(`-- Transcript (${input.messages.length} message${input.messages.length === 1 ? '' : 's'}) --`);
  if (input.messagesError) out.push(`(partial: ${input.messagesError})`);
  out.push(...formatTranscript(input.messages));
  out.push('');

  out.push('-- Tool trace (what the manager actually did) --');
  out.push('One row per platform tool call and one per model turn. A model turn recording');
  out.push('toolCalls=0 is the ONLY positive evidence that the manager narrated instead of');
  out.push('acting — the transcript cannot show it.');
  if (input.trace == null) {
    out.push(`(unavailable${input.traceError ? `: ${input.traceError}` : ''} — this is NOT the same as "it called nothing")`);
  } else {
    out.push(...formatTrace(input.trace, summarizeTrace(input.trace)));
  }
  out.push('');

  const body = out.join('\n');
  out.push(...jsonAppendix(body.length, {
    projectId: input.projectId,
    handle: input.handle,
    messages: input.messages,
    trace: input.trace,
  }, {
    note: `(rows elided: the full report would exceed ${REPORT_BUDGET_CHARS} characters. Every computed block above is intact.)`,
    compact: () => ({
      projectId: input.projectId,
      handle: input.handle,
      messages: `<elided: ${input.messages.length} messages — see the transcript above>`,
      // The trace ROLLUP survives compaction even when the rows do not: it is the block a
      // reader most needs when everything else has been trimmed.
      trace: input.trace == null ? null : summarizeTrace(input.trace),
    }),
  }));

  return out.join('\n');
}
