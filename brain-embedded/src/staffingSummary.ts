/**
 * staffingSummary — "work was filed; is anybody actually running it?"
 *
 * Measured on chat #113: a Work-mode run made 141 tool calls, filed 12 tickets
 * (epics + tasks) and staffed NOBODY. Its `kanban.coordinate`,
 * `kanban.materialize_work_items` and `kanban.assess_resource` calls all came back
 * `403 manager role required`, nothing compensated, and every other diagnostic signal
 * read clean — no exhaustion, no truncation, no narrated calls, tokens fine. The report
 * a user copied said the run was healthy, because by every signal we measured it was:
 * twelve successful creates and a wall of green tool steps.
 *
 * The missing fact is structural, not statistical: filing work and STARTING it are two
 * different outcomes, and a report that counts tool calls cannot tell them apart. This
 * module counts the second one — how many dispatch/coordination attempts were made, how
 * many of them actually put someone on the work, which ones were refused and why, and
 * whether any slice the Brain did itself was done in a real team agent's persona (a
 * `spawn_agent` carrying `as_agent`). From those four numbers the verdict falls out:
 * a ticket with nobody on it has not started, however many calls it took to create.
 *
 * Pure over the recorded trace, like the rest of `brainTriage`, so the web report, the
 * VS Code transcript and the persisted JSON report all state the same thing.
 */

import { isFailedToolResult, isTicketWriteTool, type BrainTraceEvent } from './brainTriage';

/**
 * Tool labels that put a HUMAN OR AGENT on work: the direct dispatch, the ticket
 * coordinator, the resource assessment that adds a required role, the participant
 * assignment, the work-item materialization that creates one assigned child per role,
 * and the run-now/submit path that starts an execution outright.
 *
 * Matched with `[._]` like the ticket predicate next door, because the same capability
 * reaches a trace under two spellings: the gateway ADVERTISES `builtin_kanban_coordinate`
 * while the catalog id is `kanban.coordinate`, and a label that matched only one of them
 * would under-count on whichever surface used the other.
 */
const DISPATCH_TOOL =
  /chats[._](dispatch_agent|execute_as_agent)|kanban[._](coordinate|materialize_work_items|assess_resource|assign_participant)|executions[._]submit|run[._-]?now/i;

/** True when this tool call was an attempt to put somebody on the work. */
export function isDispatchTool(label: string): boolean {
  return DISPATCH_TOOL.test(label);
}

/** Longest refusal message quoted per refused attempt — same ceiling the error steps use. */
const MAX_REFUSAL_CHARS = 180;

/** One `spawn_agent` delegation that ran in a named team agent's persona. */
export interface PersonaSubagent {
  /** The agent the parent asked for, exactly as it passed it (`as_agent`). */
  agent: string;
  /** The delegation's own label, so a reader can see WHAT that persona was given. */
  label: string;
  /** Whether the child came back with an answer. */
  ok: boolean;
}

/** One refused staffing attempt: which tool, and the reason it gave. */
export interface DispatchRefusal {
  label: string;
  message: string;
}

/**
 * What this run FILED versus what it STAFFED. Every field is a count of observed trace
 * steps — nothing here is inferred from prose.
 */
export interface StaffingSummary {
  /**
   * Board work items this run filed — created or linked. Counted with the SAME predicate
   * {@link isTicketWriteTool} that the unbacked-ticket-claim honesty check uses, so
   * "what counts as filing work" is one list in one place rather than two that drift.
   * (An Epic is a `tasks.create` with `taskType: "epic"`, so it is counted here too.)
   */
  ticketsCreated: number;
  /** Calls that tried to put somebody on work — see {@link isDispatchTool}. */
  dispatchAttempts: number;
  /** Of those, the ones that actually did: no error, and any `autoRun.dispatched` true. */
  dispatched: number;
  /** The refused ones, with the reason each gave (this is where `403 manager role required` lands). */
  dispatchRefusals: DispatchRefusal[];
  /** Delegations carrying `as_agent` — work the Brain did HERE, in a team agent's persona. */
  personaSubagents: PersonaSubagent[];
  /**
   * The one-word answer:
   *  - `no-work-filed`     — nothing was filed and nothing was staffed; there is no gap.
   *  - `staffed`           — somebody (or some persona) is on the work.
   *  - `filed-not-staffed` — work exists, and nobody was even ASKED to run it.
   *  - `staffing-refused`  — somebody was asked and the platform said no.
   */
  verdict: 'no-work-filed' | 'staffed' | 'filed-not-staffed' | 'staffing-refused';
}

/** Read a tool result as an object, parsing the JSON string form the local executors return. */
function resultObject(result: unknown): Record<string, unknown> | null {
  if (result && typeof result === 'object') return result as Record<string, unknown>;
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Did this staffing call actually staff anything?
 *
 * Two separate questions, and the second is the one that used to be missed: the call can
 * SUCCEED and still have put nobody on the work. `tasks.create` / `tasks.update` /
 * `kanban.coordinate` answer that on `autoRun.dispatched` (or a bare `dispatched`), and a
 * `dispatched:false` there is the platform saying "nothing started" in the same breath as
 * a 200. Where the result carries neither field, a non-error IS the dispatch.
 */
function didDispatch(ev: BrainTraceEvent): boolean {
  if (ev.isError || isFailedToolResult(ev.result)) return false;
  const r = resultObject(ev.result);
  if (!r) return true;
  const autoRun = r.autoRun && typeof r.autoRun === 'object' ? (r.autoRun as Record<string, unknown>) : null;
  if (autoRun && typeof autoRun.dispatched === 'boolean') return autoRun.dispatched;
  if (typeof r.dispatched === 'boolean') return r.dispatched;
  return true;
}

/** The message a refused staffing call gave, flattened and trimmed. */
function refusalMessage(ev: BrainTraceEvent): string {
  const r = resultObject(ev.result);
  const raw =
    (r && typeof r.error === 'string' && r.error)
    || (r && typeof r.detail === 'string' && r.detail)
    || (r && r.autoRun && typeof r.autoRun === 'object' && typeof (r.autoRun as Record<string, unknown>).detail === 'string'
      ? String((r.autoRun as Record<string, unknown>).detail)
      : '')
    || (typeof ev.result === 'string' ? ev.result : '')
    || (r ? JSON.stringify(r) : '')
    || 'no reason given';
  const flat = String(raw).replace(/\s+/g, ' ').trim();
  return flat.length > MAX_REFUSAL_CHARS ? `${flat.slice(0, MAX_REFUSAL_CHARS)}…` : flat || 'no reason given';
}

/** `as_agent`, as the model passed it. Empty when the delegation named no persona. */
function asAgentOf(args: unknown): string {
  const a = args && typeof args === 'object' ? (args as Record<string, unknown>) : null;
  const v = a?.as_agent;
  return typeof v === 'string' ? v.trim() : '';
}

/** Derive the staffing picture from a recorded trace. Pure — no clock, no I/O. */
export function staffingSummaryInTrace(events: BrainTraceEvent[]): StaffingSummary {
  let ticketsCreated = 0;
  let dispatchAttempts = 0;
  let dispatched = 0;
  const dispatchRefusals: DispatchRefusal[] = [];
  const personaSubagents: PersonaSubagent[] = [];

  for (const ev of events) {
    if (ev.category !== 'tool') continue;
    if (isTicketWriteTool(ev.label) && !ev.isError && !isFailedToolResult(ev.result)) ticketsCreated += 1;
    if (isDispatchTool(ev.label)) {
      dispatchAttempts += 1;
      if (didDispatch(ev)) dispatched += 1;
      else dispatchRefusals.push({ label: ev.label, message: refusalMessage(ev) });
    }
    if (ev.label === 'spawn_agent') {
      const agent = asAgentOf(ev.args);
      if (!agent) continue;
      const args = ev.args as { label?: unknown; task?: unknown } | undefined;
      const result = resultObject(ev.result);
      const label =
        (typeof args?.label === 'string' && args.label.trim())
        || (typeof result?.label === 'string' && result.label.trim())
        || (typeof args?.task === 'string' ? args.task.trim().slice(0, 60) : '')
        || 'delegated work';
      personaSubagents.push({
        agent,
        label,
        ok: !ev.isError && !isFailedToolResult(ev.result) && result?.ok !== false,
      });
    }
  }

  // Somebody on the work beats everything: a run that dispatched and was ALSO refused
  // once is staffed, not refused. Then a refusal, because it names an actionable cause.
  // Then work with nobody asked. Only a run that filed nothing and asked nobody is clear.
  const verdict: StaffingSummary['verdict'] =
    dispatched > 0 || personaSubagents.some((p) => p.ok)
      ? 'staffed'
      : dispatchRefusals.length > 0
        ? 'staffing-refused'
        : ticketsCreated > 0
          ? 'filed-not-staffed'
          : 'no-work-filed';

  return { ticketsCreated, dispatchAttempts, dispatched, dispatchRefusals, personaSubagents, verdict };
}

/**
 * The refusals, grouped by reason with counts — "manager role required ×5" rather than
 * the same sentence printed five times. Five identical refusals are ONE fact about the
 * run, and spelling them out individually buries it.
 */
export function formatDispatchRefusals(refusals: readonly DispatchRefusal[]): string {
  const counts = new Map<string, number>();
  for (const r of refusals) counts.set(r.message, (counts.get(r.message) ?? 0) + 1);
  return [...counts.entries()].map(([msg, n]) => (n > 1 ? `${msg} ×${n}` : msg)).join('; ');
}

/**
 * The "Likely cause" sentence for a run that filed work and staffed nobody. Lives here,
 * beside the numbers it quotes, so `brainTriage` reaches it in one call rather than
 * growing a second copy of this reasoning.
 */
export function workFiledNotStaffedVerdict(s: StaffingSummary): string {
  const refused = s.dispatchRefusals.length
    ? ` (${s.dispatchRefusals.length} refused: ${formatDispatchRefusals(s.dispatchRefusals)})`
    : '';
  return (
    `Likely WORK FILED BUT NOT STAFFED — ${s.ticketsCreated} ticket(s) created, ${s.dispatched} dispatched${refused}.`
    + ' Nobody is running the work.'
  );
}

/**
 * Render the staffing picture as report lines (empty when the run neither filed nor
 * staffed anything — a plain question does not need a staffing paragraph).
 */
export function formatStaffingSummary(s: StaffingSummary): string[] {
  if (s.verdict === 'no-work-filed' && s.dispatchAttempts === 0 && s.personaSubagents.length === 0) return [];
  const refused = s.dispatchRefusals.length
    ? ` (${s.dispatchRefusals.length} refused: ${formatDispatchRefusals(s.dispatchRefusals)})`
    : '';
  const tail =
    s.verdict === 'filed-not-staffed'
      ? ' — the work was filed but nobody is running it'
      : s.verdict === 'staffing-refused'
        ? ' — every attempt to staff the work was refused, so nobody is running it'
        : '';
  const lines = [
    `Staffing: ${s.ticketsCreated} ticket(s) filed · ${s.dispatched} dispatched${refused}`
    + ` · ${s.personaSubagents.length} persona sub-agent(s)${tail}`,
  ];
  // WHO did what, when the Brain did slices itself. Without this a run that quietly did
  // the work in Ada's and Kevin's personas reads identically to one that did it anonymously.
  if (s.personaSubagents.length) {
    lines.push(
      `Persona sub-agents: ${s.personaSubagents.map((p) => `${p.agent} — ${p.label}${p.ok ? '' : ' (no answer)'}`).join('; ')}`,
    );
  }
  return lines;
}
