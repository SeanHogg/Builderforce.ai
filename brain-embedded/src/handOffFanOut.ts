/**
 * Carrying a hand-off's tasks to the coders: the fan-out that starts one coding child per task
 * (in batches the host's `spawn_agents` accepts), and the numbered list the inline coder reads.
 * `planHandoff.ts` decides WHICH tasks go where; this only carries them.
 */

import type { HandOffPlan, TicketRef } from './planHandoff';
import { toolResultRecord } from './toolResultRecord';

/** The fan-out tool the editor hosts register. Named here, not imported, because the
 *  tool lives in the host; its absence is what selects the inline path. */
export const FAN_OUT_TOOL = 'spawn_agents';

/** Children one fan-out call may start — `spawn_agents`' own cap. Larger plans run in
 *  batches, one batch after another. */
export const FAN_OUT_BATCH = 4;

/** Task `i`'s full, standalone brief (`childTaskBrief` with the plan's context and its ticket). */
export type TaskBrief = (index: number) => string;

/** The run's recorded dispatcher: every call is a step on the run's record. */
export type RecordedCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/** The coder's task list: each task numbered as the plan numbers it, with its full brief. */
export function inlineTaskList(plan: HandOffPlan, indexes: readonly number[], ids: ReadonlyArray<TicketRef | undefined>, brief: TaskBrief): string {
  return indexes.map((i) => `${i + 1}. ${ids[i] != null ? `#${ids[i]} ` : ''}${plan.tasks[i]!.title}\n${brief(i)}`).join('\n\n');
}

/** What a fan-out of some tasks produced. */
export interface FanOutResult {
  workstreams: unknown[];
  changedFiles: string[];
  placeholders: unknown[];
  /** The children run in the background (the editor's handles), not to completion. */
  background: boolean;
}

/**
 * Start one coding child per task in `indexes`, in batches of {@link FAN_OUT_BATCH}. Null when
 * the FIRST batch is refused before any child started — nothing was written, so the caller
 * falls back to the inline path. A later refused batch is recorded as a failed workstream.
 */
export async function fanOut(
  plan: HandOffPlan,
  indexes: readonly number[],
  ids: ReadonlyArray<TicketRef | undefined>,
  brief: TaskBrief,
  call: RecordedCall,
): Promise<FanOutResult | null> {
  const workstreams: unknown[] = [];
  const changed = new Set<string>();
  const placeholders: unknown[] = [];
  // The editor's fan-out returns HANDLES (`agents`, `running: true`): the children work
  // in the background and report later. A host that blocks returns `workstreams`.
  let background = false;
  for (let start = 0; start < indexes.length; start += FAN_OUT_BATCH) {
    const batch = indexes.slice(start, start + FAN_OUT_BATCH);
    const out = toolResultRecord(await call(FAN_OUT_TOOL, {
      workstreams: batch.map((i) => {
        const t = plan.tasks[i]!;
        const id = ids[i];
        return {
          label: id != null ? `#${id} ${t.title}` : t.title,
          task: brief(i),
          role: 'code',
          ...(id != null ? { ticket: String(id) } : {}),
        };
      }),
    }));
    const started = Array.isArray(out?.agents) ? (out!.agents as unknown[]) : Array.isArray(out?.workstreams) ? (out!.workstreams as unknown[]) : null;
    if (!out || (out.ok === false && !started)) {
      if (start === 0) return null;
      workstreams.push({ ok: false, error: typeof out?.error === 'string' ? out.error : 'fan-out failed', tasks: batch.map((i) => plan.tasks[i]!.title) });
      continue;
    }
    if (started) workstreams.push(...started);
    if (out.running === true) background = true;
    if (Array.isArray(out.changedFiles)) for (const f of out.changedFiles) if (typeof f === 'string') changed.add(f);
    if (Array.isArray(out.placeholders)) placeholders.push(...out.placeholders);
  }
  return { workstreams, changedFiles: [...changed], placeholders, background };
}
