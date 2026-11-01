/**
 * The Brain's own tools as the agent's CLOSED `PlatformTools` (PRD 35 §4 WS4): the catalog the host advertised plus the
 * conversational `ask_user` / `hand_off`, and how one call is run.
 *
 * A call is run by the SAME steps the Brain's loop runs, never a copy: `callPreflight` (router, alias, confirm gate,
 * one-ticket attach, `hand_off`, read and write dedupe), `callRunner` (the host's runner, the ticket on the first
 * edit, the auto-link, the guards' advisories) and, once the call's result row is in the transcript, `callPostStep`
 * (its durable step and read cache). While both engines exist those three modules serve both.
 *
 * Which tools the model is shown each turn is the agent's tools policy over {@link PlatformTools.selection}; `hand_off`
 * leaves the menu when planning closes (`offersHandOff`).
 */

import { ASK_USER_TOOL_SPEC, type ParsedToolCall, type TurnContext } from '@builderforce/agent-loop';
import type { ToolSchema } from '@builderforce/agent-tools';
import type { PlatformTools, PlatformToolResult } from '@builderforce/agent-run';
import { offersHandOff } from '@builderforce/run-policy';
import type { BrainToolSpec, ChatCompletionMessage } from '../streamChatCompletion';
import { HAND_OFF_TOOL } from '../planHandoff';
import { DEFAULT_TOOL_LIMIT, relevantTools } from '../selectTools';
import { callPreflight } from '../runStore/callPreflight';
import { callRunner, declineMalformedCall } from '../runStore/callRunner';
import { callPostStep } from '../runStore/callPostStep';
import { progressAfterToolCalls } from '../runStore/progressGuard';
import type { RunLoopContext } from '../runStore/runLoopContext';
import { withRunBrief } from './brainTurnTail';
import { loopTurnMenu } from './loopTurnMenu';

/** A call that ran, waiting for its result row to join the transcript. */
interface Ran {
  call: ParsedToolCall;
  result: PlatformToolResult;
  ctx: TurnContext<ChatCompletionMessage>;
}

export interface BrainPlatform {
  tools: PlatformTools;
  /** A tool result row joined the transcript: run the call's post-step against it (FIFO, the order calls ran in). */
  toolRowAppended(row: ChatCompletionMessage): void;
}

/** The kernel-shaped call the Brain's shared steps (`callPreflight`, `callRunner`, `callPostStep`) take, and the turn context they read. */
function loopCall(run: RunLoopContext, id: string, name: string, args: Record<string, unknown>, step: number, rawArguments?: string): { call: ParsedToolCall; ctx: TurnContext<ChatCompletionMessage> } {
  const raw = { id, name, arguments: rawArguments ?? JSON.stringify(args) };
  return { call: { id, name, args, raw, malformed: rawArguments !== undefined }, ctx: { step, messages: run.convo } as unknown as TurnContext<ChatCompletionMessage> };
}

export function brainPlatformTools(run: RunLoopContext): BrainPlatform {
  const before = callPreflight(run);
  const dispatch = callRunner(run);
  const after = callPostStep(run);
  // Keyed by the call's id: a call the agent answered itself (a declined, a skipped one) never reaches `execute`, so the rows cannot be matched in order.
  const ran = new Map<string, Ran>();
  return {
    toolRowAppended(row) {
      const id = (row as { tool_call_id?: string }).tool_call_id;
      const done = id ? ran.get(id) : undefined;
      if (!done || !id) return;
      ran.delete(id);
      void after(done.call, { data: done.result.data, ...(done.result.isError ? { isError: true } : {}) }, row, done.ctx);
    },
    tools: {
      closed: true,
      // The Brain's read coverage (`callPreflight`'s exact-repeat, covered-window and replay answers, `callPostStep`'s cache) is
      // the run's one: the agent's own would answer a repeat first, in its own wording and shape.
      readsCovered: true,
      verbatimText: true,
      schemas: () => {
        const catalog = (run.allTools ?? []) as unknown as ToolSchema[];
        const conversational = run.canAskUser ? [ASK_USER_TOOL_SPEC as unknown as ToolSchema] : [];
        const names = new Set(catalog.map((t) => t.function.name));
        // `hand_off` stays in the catalog the selection ranks (a catalog is trimmed by its size, `hand_off` included, as the loop trims it);
        // it leaves the MENU when planning closes (`loopTurnMenu.ts`).
        return [...catalog, ...conversational.filter((t) => !names.has(t.function.name))];
      },
      get selection() {
        // The pins are the tools THIS run called (`callPostStep`): a tool reached through the router is the tool it reached, a fold does not
        // forget one, and an earlier run's calls pin nothing - the transcript the agent would read them off holds all three wrongly.
        // The ranking stays the Brain's own (`selectTools.ts`), not the shared scorer the cloud and the canvas keep.
        return { query: run.requestQuery, limit: DEFAULT_TOOL_LIMIT, rank: (tools: readonly ToolSchema[], query: string) => relevantTools(tools as unknown as BrainToolSpec[], query) as unknown as ToolSchema[], pinned: [...run.usedTools], required: new Set(offersHandOff(run.policy) && run.canAskUser ? [...run.alwaysAdvertised, HAND_OFF_TOOL] : run.alwaysAdvertised) };
      },
      // ONE cap on a result: the Brain's own, applied inside `callRunner` (`trimToolResult`, by LINE, sized to the serving
      // model's window). The agent's per-tool cap would cut the already budgeted text a second time and drop its paging fields.
      resultCap: () => Number.MAX_SAFE_INTEGER,
      // No `handsOff`: `hand_off` reports itself to the model policy inside `callPreflight` (through the run's view), and a
      // call the agent hands off first would find the plan already closed.
      turn: async (env) => withRunBrief(run, await loopTurnMenu(run, env, run.allTools?.length ?? 0)),
      // A3's detector is the Brain's own (`progressGuard.ts`): the turn is judged when its calls have all run, as the loop does.
      turnEnded: progressAfterToolCalls(run),
      // The turn's step, as the kernel numbers it: the router, the hand-off, the confirm gate, the guards, the activity line and the
      // no-progress streak (`CacheServedStreak` counts distinct TURNS) all stamp it, so it is not a per-call counter.
      async execute(name, args, env): Promise<PlatformToolResult> {
        const id = env.callId ?? `brain-${env.step}-${ran.size + 1}`;
        const { call, ctx } = loopCall(run, id, name, args, env.step);
        const pre = await before(call, ctx);
        let result: PlatformToolResult;
        if (pre && 'result' in pre) result = pre.result;
        else result = await dispatch(pre && 'rewrite' in pre ? pre.rewrite : call, ctx);
        ran.set(id, { call: pre && 'rewrite' in pre ? pre.rewrite : call, result, ctx });
        return result;
      },
      // A call whose arguments never parsed is answered as the loop answers it: the preflight first (an `ask_user` has a corrective of
      // its own, a `hand_off` names what it needs), else the shared decline and its trace step. The progress detector sees it either way.
      malformed: {
        roundDirective: () => '',
        async answer(raw, { step }) {
          const { call, ctx } = loopCall(run, raw.id, raw.name, {}, step, raw.arguments);
          const pre = await before(call, ctx);
          const target = pre && 'rewrite' in pre ? pre.rewrite : call;
          const result: PlatformToolResult = pre && 'result' in pre ? pre.result : (declineMalformedCall(run, target) as PlatformToolResult);
          ran.set(raw.id, { call: target, result, ctx });
          return result;
        },
      },
    },
  };
}
