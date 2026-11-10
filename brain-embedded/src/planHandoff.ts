/**
 * Planning ends in TASKS, and the tasks are the hand-off to the coding model.
 *
 * Two ways a run leaves planning. A SMALL change is simply made: the planner's first edit
 * moves the run into coding (auto-routed, that edit is re-asked of the coding model —
 * `code_change_attempted` in `@builderforce/run-policy`). Telling the planner it must never
 * edit kept Hybrid runs reading for hundreds of turns without touching a file, so the tool
 * below is OPTIONAL. MULTI-TASK work ends in `hand_off` instead, because the implicit path
 * files nothing and cannot run in parallel (chat #133: MiniMax planned for 22 turns, Grok
 * then re-did it).
 *
 * `hand_off` names the tasks; the run then:
 *   1. files ONE ticket per task, linked to the chat (the board shows the plan);
 *   2. posts the plan into the chat;
 *   3. switches the run to the coding role, and
 *      • where the host can fan out (`spawn_agents`, the editor), starts one coding child
 *        per leading task that owns disjoint paths, side by side — in the editor they run in
 *        the BACKGROUND (the coder keeps working; each child posts into the chat under its own
 *        name and its report reaches the coder when it finishes). From the first task that
 *        overlaps, or owns none, onward the coder takes them in plan order
 *        (`handOffParallelism.ts` decides the split; `handOffFanOut.ts` carries it);
 *      • otherwise hands the coder the task list to implement in order.
 *   Every filed ticket moves to `in_progress` as the work starts.
 *
 * Pure apart from the injected ports, so the run store only wires it.
 */

import type { BrainToolSpec } from './streamChatCompletion';
import { BACKGROUND_NEXT, INLINE_NEXT, MIXED_BACKGROUND_NEXT, MIXED_PARALLEL_NEXT, PARALLEL_NEXT } from './handOffNext';
import { ticketStatusMove, ticketToolVocabulary } from './ticketToolVocabulary';
import { toolResultRecord } from './toolResultRecord';
import { FAN_OUT_TOOL, fanOut, inlineTaskList } from './handOffFanOut';
import { modeOf, splitForParallel, splitLayoutLine, type HandOffDecision, type HandOffMode, type ParallelSplit, type ScopeClash } from './handOffParallelism';

export { canRunInParallel } from './handOffParallelism';
export type { HandOffDecision, HandOffMode, ScopeClash } from './handOffParallelism';

export const HAND_OFF_TOOL = 'hand_off';

export { FAN_OUT_BATCH, FAN_OUT_TOOL } from './handOffFanOut';

/** Tasks one plan may carry. Beyond this the plan is a roadmap, not a hand-off. */
export const MAX_HAND_OFF_TASKS = 12;

/** A ticket's reference: the account's numeric id, or the editor's local id (a UUID). */
export type TicketRef = number | string;

export const HAND_OFF_TOOL_SPEC: BrainToolSpec = {
  type: 'function',
  function: {
    name: HAND_OFF_TOOL,
    description:
      'OPTIONAL — for work that splits into SEVERAL separate tasks. A change you can already make (a bug fix, a small refactor, a copy or style change, anything a few edits cover) you simply MAKE now: your first edit moves the run into coding by itself, no hand_off needed, so never stall in analysis waiting to call this. ' +
      'When the work genuinely breaks into multiple tasks, call this ONCE with them instead of editing. Each task becomes a ticket linked to this chat. Tasks that own separate files run side by side, one coding agent each, and each reports back to this chat; otherwise the coding model implements them in order. ' +
      'Every task must stand alone — the agent that implements it sees none of this conversation: say what to change, where, and how to know it is done.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description:
            'The research, summarised for the coders — they see nothing else. Everything your analysis AND any research sub-agents reported that the change needs: '
            + 'the files and functions involved, what they do today, the decisions made and why, and the traps found. Facts, not a recap of what you did.',
        },
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_HAND_OFF_TASKS,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Ticket title, e.g. "Rebuild UserDetailDrawer on SlideOutPanel".' },
              brief: { type: 'string', description: 'The complete, standalone instruction: files, the change, the primitives to use.' },
              paths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Workspace-relative files or directories this task OWNS. Tasks with disjoint paths run in parallel.',
              },
              acceptance: { type: 'string', description: 'How to know it is done (tests, behaviour).' },
              constraints: {
                type: 'string',
                description: 'What the coder must NOT do: files or modules to leave alone, primitives to reuse rather than copy, files not to grow, behaviour that must not change.',
              },
            },
            required: ['title', 'brief'],
          },
        },
      },
      required: ['summary', 'tasks'],
    },
  },
};

export interface HandOffTask {
  title: string;
  brief: string;
  paths: string[];
  acceptance?: string;
  /** What not to touch, copy or grow — the limits a standalone brief must carry. */
  constraints?: string;
}

export interface HandOffPlan {
  summary: string;
  tasks: HandOffTask[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Validate the planner's arguments. A string is the corrective the model is handed. */
export function parseHandOff(args: unknown): HandOffPlan | string {
  const a = (args ?? {}) as Record<string, unknown>;
  const summary = str(a.summary);
  if (!Array.isArray(a.tasks) || a.tasks.length === 0) {
    return 'hand_off needs { summary, tasks:[{ title, brief, paths? }] } with at least one task';
  }
  if (a.tasks.length > MAX_HAND_OFF_TASKS) {
    return `at most ${MAX_HAND_OFF_TASKS} tasks per hand-off — merge related slices`;
  }
  const tasks: HandOffTask[] = [];
  for (const [i, raw] of a.tasks.entries()) {
    const t = (raw ?? {}) as Record<string, unknown>;
    const title = str(t.title);
    const brief = str(t.brief);
    if (!title || !brief) return `task ${i + 1} needs both a title and a brief`;
    const paths = Array.isArray(t.paths) ? t.paths.map(str).filter(Boolean) : [];
    const acceptance = str(t.acceptance);
    const constraints = str(t.constraints);
    tasks.push({ title, brief, paths, ...(acceptance ? { acceptance } : {}), ...(constraints ? { constraints } : {}) });
  }
  return { summary, tasks };
}

/**
 * Longest excerpt of the plan's summary a TICKET carries. The whole summary rode on every ticket
 * (chat #70776: four `ticket-create` calls of 7–9 KB each); the children and the inline coder
 * still get it in full through {@link childTaskBrief}.
 */
export const TICKET_CONTEXT_MAX_CHARS = 600;

/** The ticket body — the brief, where it lives, how it is accepted, and a short excerpt of the research. */
export function ticketDescription(task: HandOffTask, summary: string): string {
  const context = summary.length > TICKET_CONTEXT_MAX_CHARS ? `${summary.slice(0, TICKET_CONTEXT_MAX_CHARS - 1).trimEnd()}…` : summary;
  return [
    task.brief,
    task.paths.length ? `Paths: ${task.paths.join(', ')}` : '',
    task.acceptance ? `Done when: ${task.acceptance}` : '',
    task.constraints ? `Do not: ${task.constraints}` : '',
    context ? `Context: ${context}` : '',
  ].filter(Boolean).join('\n\n');
}

/** What every task of one plan shares — the run's side of a child's brief. */
export interface BriefContext {
  /** The planner's summary of the research. */
  summary: string;
  /** What the user asked for, in their words — the goal every slice serves. */
  request?: string | null;
  /** The planning run's record of what it read and searched (`RunKnowledgeLog.brief`). */
  knowledge?: string | null;
}

/** Longest request quoted into a brief; a pasted transcript is not the goal. */
const MAX_REQUEST_CHARS = 2_000;

/**
 * A child's whole brief. It sees nothing else, so everything the coder would otherwise
 * have to rediscover rides along: the goal in the user's words, the slice and its limits,
 * how it is accepted, the planner's summary of the research and the run's record of what
 * was already read. How it REPORTS is its standing instructions (`subagentSystemPrompt`).
 */
export function childTaskBrief(task: HandOffTask, ctx: BriefContext, ticketId?: TicketRef): string {
  const request = ctx.request?.trim();
  return [
    ticketId != null ? `Ticket #${ticketId}: ${task.title}` : task.title,
    request ? `The goal — what the user asked for: ${request.length > MAX_REQUEST_CHARS ? `${request.slice(0, MAX_REQUEST_CHARS)}…` : request}` : '',
    task.brief,
    task.paths.length ? `Your slice covers: ${task.paths.join(', ')}. Sibling slices are working beside you on other paths.` : '',
    task.constraints ? `Do not: ${task.constraints}` : '',
    task.acceptance ? `Done when: ${task.acceptance}` : '',
    ctx.summary ? `Research handed to you (the analysis is finished — do not redo it): ${ctx.summary}` : '',
    ctx.knowledge ? `What the research already read and searched (read again only what your change itself needs):\n${ctx.knowledge}` : '',
    'Make the change now. Read only what the change itself needs.',
  ].filter(Boolean).join('\n\n');
}

/**
 * The plan as the user reads it in the chat. `layout` is either whether the whole plan runs
 * side by side, or the split the run chose — which then also says which tasks run in order and why.
 */
export function planMessage(plan: HandOffPlan, ticketIds: ReadonlyArray<TicketRef | undefined>, layout: boolean | ParallelSplit): string {
  const lines = plan.tasks.map((t, i) => {
    const id = ticketIds[i];
    return `${i + 1}. ${id != null ? `#${id} ` : ''}${t.title}${t.paths.length ? ` — ${t.paths.join(', ')}` : ''}`;
  });
  const mode = typeof layout === 'boolean' ? (layout ? 'parallel' : 'inline') : modeOf(layout);
  const header = mode === 'parallel' ? ' (running side by side; each reports back here)'
    : mode === 'mixed' ? ' (partly side by side; each agent reports back here)'
    : '';
  return [
    `**Plan — ${plan.tasks.length} task${plan.tasks.length === 1 ? '' : 's'}**${header}`,
    typeof layout === 'boolean' ? '' : splitLayoutLine(layout),
    plan.summary,
    lines.join('\n'),
  ].filter(Boolean).join('\n\n');
}

/** What the run hands the executor. */
export interface HandOffPorts {
  /** The run's own dispatcher — the same relay and gates the model's calls ride. */
  runTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Every tool name the host advertises this run. */
  toolNames: ReadonlySet<string>;
  /** The planning run's record of what it read and searched (`RunKnowledgeLog.brief`). */
  knowledge?: string | null;
  /** What the user asked for — every child's brief opens with the goal. */
  request?: string | null;
  projectId?: number;
  /** Called with each created ticket's result, so the run links it to the chat. */
  afterCreate?(toolName: string, out: unknown): Promise<void>;
  /** Record a step the run took on the planner's behalf. */
  step?(label: string, args: Record<string, unknown>, out: unknown, durationMs: number): void;
  /** Post the plan into the chat. */
  postPlan?(text: string): Promise<void>;
  /** Told how the plan was finally carried out (after any fan-out refusal), for the run's record. */
  decided?(decision: HandOffDecision): void;
  now?(): number;
}

/** What the coding model reads back as the `hand_off` result. */
export interface HandOffOutcome {
  ok: boolean;
  mode: HandOffMode;
  tickets: Array<{ title: string; id?: TicketRef }>;
  workstreams?: unknown[];
  changedFiles?: string[];
  /** Placeholders the children wrote, for the run's placeholder guard. */
  placeholders?: unknown[];
  /** The overlap that kept tasks out of the fan-out (`inline` / `mixed` only). */
  clash?: ScopeClash;
  next: string;
}

function isFailed(out: unknown): boolean {
  if (out == null) return true;
  if (typeof out !== 'object') return false;
  const o = out as { ok?: unknown; error?: unknown };
  return o.ok === false || (typeof o.error === 'string' && o.error.length > 0);
}

async function call(ports: HandOffPorts, name: string, args: Record<string, unknown>): Promise<unknown> {
  const now = ports.now ?? (() => Date.now());
  const start = now();
  let out: unknown;
  try {
    out = await ports.runTool(name, args);
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  ports.step?.(name, { ...args, auto: true, reason: 'hand_off' }, out, now() - start);
  return out;
}

/** File one ticket per task. A task whose ticket fails still runs — the work matters more
 *  than its card, and the run's own delta backstop will still record what changed. */
async function fileTickets(plan: HandOffPlan, ports: HandOffPorts): Promise<Array<TicketRef | undefined>> {
  // Whichever create tool the catalog carries: the account's (numeric ids) or the editor's
  // device-local `ticket-create` (local ids; it links its chat itself).
  const vocabulary = ticketToolVocabulary(ports.toolNames);
  const createTool = vocabulary.createTool;
  if (ports.projectId == null || !createTool) return plan.tasks.map(() => undefined);
  const ids: Array<TicketRef | undefined> = [];
  for (const task of plan.tasks) {
    const out = await call(ports, createTool, {
      // The local tool takes its project as text; the account's takes the number.
      projectId: vocabulary.local ? String(ports.projectId) : ports.projectId,
      title: task.title,
      description: ticketDescription(task, plan.summary),
      taskType: 'task',
    });
    // A host may hand the result back as JSON text.
    const record = toolResultRecord(out);
    const failed = isFailed(record ?? out);
    const id = !failed ? record?.id : undefined;
    ids.push(typeof id === 'number' || (vocabulary.local && typeof id === 'string' && id) ? id : undefined);
    if (!failed) await ports.afterCreate?.(createTool, out).catch(() => undefined);
  }
  return ids;
}

/**
 * The work starts now, side by side or inline: move every filed ticket to `in_progress` with the
 * status tool of the vocabulary that filed it — when the host advertises that tool. Each move is a
 * recorded step; a refused one leaves the ticket where it was and the run goes on.
 */
async function startTickets(ids: ReadonlyArray<TicketRef | undefined>, ports: HandOffPorts): Promise<void> {
  const vocabulary = ticketToolVocabulary(ports.toolNames);
  for (const id of ids) {
    if (id == null) continue;
    const move = ticketStatusMove(id, 'in_progress', vocabulary);
    if (!move || !ports.toolNames.has(move.tool)) continue;
    await call(ports, move.tool, { ...move.args });
  }
}

/**
 * Carry the plan out. Never throws: a failed ticket or a refused fan-out degrades to the
 * inline path, which is always available — the coder is the run itself.
 */
export async function executeHandOff(plan: HandOffPlan, ports: HandOffPorts): Promise<HandOffOutcome> {
  const ids = await fileTickets(plan, ports);
  await startTickets(ids, ports);
  const tickets = plan.tasks.map((t, i) => ({ title: t.title, ...(ids[i] != null ? { id: ids[i] } : {}) }));
  const all = plan.tasks.map((_, i) => i);
  const canFanOut = ports.toolNames.has(FAN_OUT_TOOL);
  const split: ParallelSplit = canFanOut ? splitForParallel(plan.tasks) : { parallel: [], inline: all, clash: null };
  const briefContext: BriefContext = { summary: plan.summary, request: ports.request, knowledge: ports.knowledge };
  const brief = (i: number): string => childTaskBrief(plan.tasks[i]!, briefContext, ids[i]);
  await ports.postPlan?.(planMessage(plan, ids, split)).catch(() => undefined);

  const decide = (mode: HandOffMode, parallel: readonly number[], inline: readonly number[]): void => ports.decided?.({
    mode,
    parallelTasks: parallel.map((i) => plan.tasks[i]!.title),
    inlineTasks: inline.map((i) => plan.tasks[i]!.title),
    clash: split.clash,
  });
  const clash = split.clash ? { clash: split.clash } : {};

  const ran = split.parallel.length ? await fanOut(plan, split.parallel, ids, brief, (name, args) => call(ports, name, args)) : null;
  if (ran) {
    const mode = modeOf(split);
    decide(mode, split.parallel, split.inline);
    // Key order is the order the coder reads the result in; a full fan-out reads as it always has.
    return {
      ok: true,
      mode,
      tickets,
      workstreams: ran.workstreams,
      ...(ran.changedFiles.length ? { changedFiles: ran.changedFiles } : {}),
      ...(ran.placeholders.length ? { placeholders: ran.placeholders } : {}),
      ...(mode === 'mixed' ? clash : {}),
      next: mode === 'parallel'
        ? (ran.background ? BACKGROUND_NEXT : PARALLEL_NEXT)
        : `${ran.background ? MIXED_BACKGROUND_NEXT : MIXED_PARALLEL_NEXT}\n\n${inlineTaskList(plan, split.inline, ids, brief)}`,
    };
  }

  decide('inline', [], all);
  return {
    ok: true,
    mode: 'inline',
    tickets,
    ...clash,
    next: `${INLINE_NEXT}\n\n${inlineTaskList(plan, all, ids, brief)}`,
  };
}
