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
 *      • where the host can fan out (`spawn_agents`, the editor) and the tasks own
 *        disjoint paths, starts one coding child per task, side by side — in the editor
 *        they run in the BACKGROUND (the coder keeps working; each child posts into the
 *        chat under its own name and its report reaches the coder when it finishes);
 *      • otherwise hands the coder the task list to implement in order.
 *
 * Pure apart from the injected ports, so the run store only wires it.
 */

import type { BrainToolSpec } from './streamChatCompletion';
import { RESOLVE_OPEN_ISSUES, VERIFY_DELEGATION_STEP, VERIFY_STEP, overlappingScopes } from '@builderforce/agent-tools';

export const HAND_OFF_TOOL = 'hand_off';

/** The fan-out tool the editor hosts register. Named here, not imported, because the
 *  tool lives in the host; its absence is what selects the inline path. */
export const FAN_OUT_TOOL = 'spawn_agents';

/** Children one fan-out call may start — `spawn_agents`' own cap. Larger plans run in
 *  batches, one batch after another. */
export const FAN_OUT_BATCH = 4;

/** Tasks one plan may carry. Beyond this the plan is a roadmap, not a hand-off. */
export const MAX_HAND_OFF_TASKS = 12;

const TASK_CREATE_TOOL = 'builtin_tasks_create';

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

/** The ticket body — the brief, where it lives, and how it is accepted. */
function ticketDescription(task: HandOffTask, summary: string): string {
  return [
    task.brief,
    task.paths.length ? `Paths: ${task.paths.join(', ')}` : '',
    task.acceptance ? `Done when: ${task.acceptance}` : '',
    task.constraints ? `Do not: ${task.constraints}` : '',
    summary ? `Context: ${summary}` : '',
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
export function childTaskBrief(task: HandOffTask, ctx: BriefContext, ticketId?: number): string {
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
 * Whether the plan can run side by side: two or more tasks, every one owning paths, and
 * no two owning the same file. A plan that fails this runs inline, in order — the safe
 * reading of a breakdown whose slices touch each other. This is where slices are kept
 * apart: every child is a clone of its owner, and nothing downstream restricts it.
 */
export function canRunInParallel(tasks: readonly HandOffTask[]): boolean {
  if (tasks.length < 2 || tasks.some((t) => t.paths.length === 0)) return false;
  return overlappingScopes(tasks.map((t) => ({ label: t.title, paths: t.paths }))) === null;
}

/** The plan as the user reads it in the chat. */
export function planMessage(plan: HandOffPlan, ticketIds: ReadonlyArray<number | undefined>, parallel: boolean): string {
  const lines = plan.tasks.map((t, i) => {
    const id = ticketIds[i];
    return `${i + 1}. ${id != null ? `#${id} ` : ''}${t.title}${t.paths.length ? ` — ${t.paths.join(', ')}` : ''}`;
  });
  return [
    `**Plan — ${plan.tasks.length} task${plan.tasks.length === 1 ? '' : 's'}**${parallel ? ' (running side by side; each reports back here)' : ''}`,
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
  now?(): number;
}

/** What the coding model reads back as the `hand_off` result. */
export interface HandOffOutcome {
  ok: boolean;
  mode: 'parallel' | 'inline';
  tickets: Array<{ title: string; id?: number }>;
  workstreams?: unknown[];
  changedFiles?: string[];
  /** Placeholders the children wrote, for the run's placeholder guard. */
  placeholders?: unknown[];
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
async function fileTickets(plan: HandOffPlan, ports: HandOffPorts): Promise<Array<number | undefined>> {
  if (ports.projectId == null || !ports.toolNames.has(TASK_CREATE_TOOL)) return plan.tasks.map(() => undefined);
  const ids: Array<number | undefined> = [];
  for (const task of plan.tasks) {
    const out = await call(ports, TASK_CREATE_TOOL, {
      projectId: ports.projectId,
      title: task.title,
      description: ticketDescription(task, plan.summary),
      taskType: 'task',
    });
    const id = !isFailed(out) ? (out as { id?: unknown }).id : undefined;
    ids.push(typeof id === 'number' ? id : undefined);
    if (!isFailed(out)) await ports.afterCreate?.(TASK_CREATE_TOOL, out).catch(() => undefined);
  }
  return ids;
}

/** Parse a host tool's result, which may arrive as a JSON string. */
function asRecord(out: unknown): Record<string, unknown> | null {
  if (typeof out === 'string') {
    try {
      const parsed = JSON.parse(out) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return out && typeof out === 'object' ? (out as Record<string, unknown>) : null;
}

const INLINE_NEXT =
  'HAND-OFF: the analysis is complete and you are the coding model. Implement the tasks below in order — do not re-plan or re-read what the planner already read. ' +
  `When all are done, check them. ${VERIFY_STEP} Then commit and push, and report per ticket.`;

/** What every fan-out leaves the coder: the children's open issues are its work now. */
const RESOLVE_REPORTS =
  `Each report ends with its Open issues — ${RESOLVE_OPEN_ISSUES}. Fix what the slices broke between them, and implement any task that failed.`;

// A host that fanned out can spawn, so the checking is always delegated from here.
const PARALLEL_NEXT =
  'HAND-OFF: the tasks ran side by side, one coding agent each, and each has reported into the chat. ' +
  `You are the coding model. ${RESOLVE_REPORTS} Then check the combined change. ${VERIFY_DELEGATION_STEP} Then commit, push and report per ticket.`;

const BACKGROUND_NEXT =
  'HAND-OFF: one coding agent per task is now running IN THE BACKGROUND, each posting into the chat under its own name. ' +
  'You are the coding model: do not redo their tasks. Work on anything not delegated, then call wait_agents for their reports (or act on each as it arrives). ' +
  `${RESOLVE_REPORTS} Then check the combined change. ${VERIFY_DELEGATION_STEP} Then commit, push and report per ticket.`;

/**
 * Carry the plan out. Never throws: a failed ticket or a refused fan-out degrades to the
 * inline path, which is always available — the coder is the run itself.
 */
export async function executeHandOff(plan: HandOffPlan, ports: HandOffPorts): Promise<HandOffOutcome> {
  const ids = await fileTickets(plan, ports);
  const tickets = plan.tasks.map((t, i) => ({ title: t.title, ...(ids[i] != null ? { id: ids[i] } : {}) }));
  const parallel = ports.toolNames.has(FAN_OUT_TOOL) && canRunInParallel(plan.tasks);
  const briefContext: BriefContext = { summary: plan.summary, request: ports.request, knowledge: ports.knowledge };
  await ports.postPlan?.(planMessage(plan, ids, parallel)).catch(() => undefined);

  if (parallel) {
    const workstreams: unknown[] = [];
    const changed = new Set<string>();
    const placeholders: unknown[] = [];
    let fanOutOk = true;
    // The editor's fan-out returns HANDLES (`agents`, `running: true`): the children work
    // in the background and report later. A host that blocks returns `workstreams`.
    let background = false;
    for (let start = 0; start < plan.tasks.length; start += FAN_OUT_BATCH) {
      const batch = plan.tasks.slice(start, start + FAN_OUT_BATCH);
      const out = asRecord(await call(ports, FAN_OUT_TOOL, {
        workstreams: batch.map((t, k) => {
          const id = ids[start + k];
          return {
            label: id != null ? `#${id} ${t.title}` : t.title,
            task: childTaskBrief(t, briefContext, id),
            role: 'code',
            ...(id != null ? { ticket: String(id) } : {}),
          };
        }),
      }));
      // A refusal BEFORE any child started (a persona that does not resolve): nothing was written,
      // so the whole plan falls back to the inline path below.
      const started = Array.isArray(out?.agents) ? (out!.agents as unknown[]) : Array.isArray(out?.workstreams) ? (out!.workstreams as unknown[]) : null;
      if (!out || (out.ok === false && !started)) {
        if (start === 0) {
          fanOutOk = false;
          break;
        }
        workstreams.push({ ok: false, error: typeof out?.error === 'string' ? out.error : 'fan-out failed', tasks: batch.map((t) => t.title) });
        continue;
      }
      if (started) workstreams.push(...started);
      if (out.running === true) background = true;
      if (Array.isArray(out.changedFiles)) for (const f of out.changedFiles) if (typeof f === 'string') changed.add(f);
      if (Array.isArray(out.placeholders)) placeholders.push(...out.placeholders);
    }
    if (fanOutOk) {
      return {
        ok: true,
        mode: 'parallel',
        tickets,
        workstreams,
        ...(changed.size ? { changedFiles: [...changed] } : {}),
        ...(placeholders.length ? { placeholders } : {}),
        next: background ? BACKGROUND_NEXT : PARALLEL_NEXT,
      };
    }
  }

  return {
    ok: true,
    mode: 'inline',
    tickets,
    next: `${INLINE_NEXT}\n\n${plan.tasks.map((t, i) => `${i + 1}. ${ids[i] != null ? `#${ids[i]} ` : ''}${t.title}\n${childTaskBrief(t, briefContext, ids[i])}`).join('\n\n')}`,
  };
}
