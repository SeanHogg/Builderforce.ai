/**
 * The Brain's own tools as the agent's CLOSED `PlatformTools` (PRD 35 §4 WS4): the catalog the host advertised plus the
 * conversational `ask_user` / `hand_off`, and how one call is run.
 *
 * A call is run by the SAME steps the Brain's loop runs, never a copy: `beforeDispatchHook` (router, alias, confirm gate,
 * one-ticket attach, `hand_off`, read and write dedupe), `dispatchToolPort` (the host's runner, the ticket on the first
 * edit, the auto-link, the guards' advisories) and, once the call's result row is in the transcript, `afterDispatchHook`
 * (its durable step and read cache). While both engines exist those three modules serve both.
 *
 * Which tools the model is shown each turn is the agent's tools policy over {@link PlatformTools.selection}; `hand_off`
 * leaves the menu when planning closes (`offersHandOff`).
 */

import { ASK_USER_TOOL_SPEC, type ParsedToolCall, type TurnContext } from '@builderforce/agent-loop';
import type { ToolSchema } from '@builderforce/agent-tools';
import type { PlatformTools, PlatformToolResult } from '@builderforce/agent-run';
import { offersHandOff } from '@builderforce/run-policy';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { HAND_OFF_TOOL } from '../planHandoff';
import { DEFAULT_TOOL_LIMIT } from '../selectTools';
import { beforeDispatchHook } from '../runStore/beforeDispatch';
import { dispatchToolPort } from '../runStore/dispatchTool';
import { afterDispatchHook } from '../runStore/toolCallHooks';
import type { RunLoopContext } from '../runStore/runLoopContext';

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

export function brainPlatformTools(run: RunLoopContext): BrainPlatform {
  const before = beforeDispatchHook(run);
  const dispatch = dispatchToolPort(run);
  const after = afterDispatchHook(run);
  const ran: Ran[] = [];
  let step = 0;
  return {
    toolRowAppended(row) {
      const done = ran.shift();
      if (done) void after(done.call, { data: done.result.data, ...(done.result.isError ? { isError: true } : {}) }, row, done.ctx);
    },
    tools: {
      closed: true,
      verbatimText: true,
      schemas: () => {
        const catalog = (run.allTools ?? []) as unknown as ToolSchema[];
        const conversational = run.canAskUser ? [ASK_USER_TOOL_SPEC as unknown as ToolSchema] : [];
        const names = new Set(catalog.map((t) => t.function.name));
        return [...catalog, ...conversational.filter((t) => !names.has(t.function.name))].filter(
          (t) => t.function.name !== HAND_OFF_TOOL || offersHandOff(run.policy),
        );
      },
      get selection() {
        return { query: run.requestQuery, limit: DEFAULT_TOOL_LIMIT, required: new Set(offersHandOff(run.policy) && run.canAskUser ? [...run.alwaysAdvertised, HAND_OFF_TOOL] : run.alwaysAdvertised) };
      },
      handsOff: (name) => name === HAND_OFF_TOOL,
      async execute(name, args): Promise<PlatformToolResult> {
        step += 1;
        const ctx = { step, messages: run.convo } as unknown as TurnContext<ChatCompletionMessage>;
        const call: ParsedToolCall = { id: `brain-${step}`, name, args, raw: { id: `brain-${step}`, name, arguments: JSON.stringify(args) }, malformed: false };
        const pre = await before(call, ctx);
        let result: PlatformToolResult;
        if (pre && 'result' in pre) result = pre.result;
        else result = await dispatch(pre && 'rewrite' in pre ? pre.rewrite : call, ctx);
        ran.push({ call: pre && 'rewrite' in pre ? pre.rewrite : call, result, ctx });
        return result;
      },
    },
  };
}
