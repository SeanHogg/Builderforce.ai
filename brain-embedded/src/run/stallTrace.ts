/**
 * The trace steps of a stall the one agent judged (`stall.recovered`), in the Brain's own labels - the ones the loop's
 * final-answer hook records (`loop.recover_*`, `loop.model_failover`, `loop.stall_unrecovered`) and every diagnostics reader keys
 * on. Pure over the event; `eventSink.ts` renders it.
 */

import { MAX_ANNOUNCEMENT_RECOVERIES, modelFailoverNotice, type StallShapeArg } from '@builderforce/agent-stall';
import type { RunEvent } from '@builderforce/agent-run';
import type { BrainTraceEvent } from '../brainTriage';

type Stalled = Extract<RunEvent, { kind: 'stall.recovered' }>;

const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** The size of the menu the stalled turn advertised, when the run says (the loop's `advertisedTools`). */
const menuArg = (d: Record<string, unknown>): { advertisedTools?: number } => (num(d.advertisedTools) !== undefined ? { advertisedTools: num(d.advertisedTools) as number } : {});

/** The step a stall leaves, or null for an action the Brain's loop leaves no step for (a settle, a fail). */
export function stallTraceStep(event: Stalled, ts: string): BrainTraceEvent | null {
  const d = event.detail ?? {};
  const shape = d.shape as StallShapeArg;
  switch (event.action) {
    case 'steer': {
      // Only the stall ladder's narration nudges carry an attempt: a delivery rung has its own step (`brainDelivery.ts`).
      const attempt = num(d.attempt);
      if (attempt === undefined) return null;
      const handedOff = shape === 'handed-off';
      return {
        ts,
        category: 'message',
        label: handedOff ? 'loop.recover_handed_off_work' : 'loop.recover_announced_tool_call',
        args: { step: event.step, attempt, of: MAX_ANNOUNCEMENT_RECOVERIES, ...menuArg(d), shape },
        result: handedOff
          ? `Model ended by telling the user to run the commands itself holds tools for — re-prompted to run them (${attempt}/${MAX_ANNOUNCEMENT_RECOVERIES}).`
          : `Model announced a tool call without making one — re-prompted (${attempt}/${MAX_ANNOUNCEMENT_RECOVERIES}).`,
      };
    }
    case 'escalate': {
      const from = text(d.from);
      const to = text(d.to);
      if (!to) return null;
      return {
        ts,
        category: 'message',
        label: 'loop.model_failover',
        args: { step: event.step, from: from ?? 'default', to, attempt: num(d.attempt), of: num(d.of) },
        result: text(d.notice) ?? modelFailoverNotice(from ?? 'default', to, shape),
      };
    }
    case 'pause':
      return {
        ts,
        category: 'error',
        label: 'loop.stall_unrecovered',
        args: { step: event.step, model: text(d.model), ...(num(d.attempts) !== undefined ? { attempts: num(d.attempts) } : {}), tried: d.tried, ...menuArg(d), shape },
        result: event.note ?? 'The model kept describing calls instead of making them.',
        isError: true,
      };
    default:
      return null;
  }
}
