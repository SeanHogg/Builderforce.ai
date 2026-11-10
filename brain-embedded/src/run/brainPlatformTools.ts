/**
 * The Brain's own tools as the agent's CLOSED `PlatformTools` (PRD 35 §4 WS4): the catalog the host advertised plus the
 * conversational `ask_user` / `hand_off`, and how one call is run.
 *
 * A call is run by the Brain's one set of steps, never a copy: `callPreflight` (router, alias, confirm gate,
 * one-ticket attach, `hand_off`, read and write dedupe), `callRunner` (the host's runner, the ticket on the first
 * edit, the auto-link, the guards' advisories) and, once the call's result row is in the transcript, `callPostStep`
 * (its durable step and read cache).
 *
 * Which tools the model is shown each turn is the agent's tools policy over {@link PlatformTools.selection}; `hand_off`
 * leaves the menu when planning closes (`offersHandOff`).
 */

import { ASK_USER_TOOL, ASK_USER_TOOL_SPEC, type ParsedToolCall, type TurnContext } from '@builderforce/agent-loop';
import { resolveToolAlias, type ToolSchema } from '@builderforce/agent-tools';
import { DEFAULT_TOOL_LIMIT, isCappedToolRole, type PlatformTools, type PlatformToolResult } from '@builderforce/agent-run';
import { offersHandOff } from '@builderforce/run-policy';
import type { BrainToolSpec, ChatCompletionMessage } from '../streamChatCompletion';
import { HAND_OFF_TOOL } from '../planHandoff';
import { relevantTools } from '../selectTools';
import { isRouterTool } from '../toolRouter';
import { canChangeCodeHere, localToolsIn, memoryToolsIn, studioToolsIn } from '../localWorkspaceTools';
import { skillToolsIn } from '../skillLibraryTools';
import { callPreflight, traceRouted } from '../runStore/callPreflight';
import { callRunner, declineMalformedCall } from '../runStore/callRunner';
import { callPostStep } from '../runStore/callPostStep';
import { progressAfterToolCalls } from '../runStore/progressGuard';
import type { BrainRunContext } from '../runStore/brainRunContext';
import { withRunBrief } from './brainTurnTail';
import { brainTurnMenu } from './brainTurnMenu';

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
function kernelCall(run: BrainRunContext, id: string, name: string, args: Record<string, unknown>, step: number, rawArguments?: string): { call: ParsedToolCall; ctx: TurnContext<ChatCompletionMessage> } {
  const raw = { id, name, arguments: rawArguments ?? JSON.stringify(args) };
  return { call: { id, name, args, raw, malformed: rawArguments !== undefined }, ctx: { step, messages: run.convo } as unknown as TurnContext<ChatCompletionMessage> };
}

type NamingRun = Pick<BrainRunContext, 'catalogToolNames' | 'promptTools'>;

/** The host's surface vocabulary: its workspace, Studio, memory and skill tools (`runPreamble.ts` puts all of them in `alwaysAdvertised`). */
function vocabularyOf(names: readonly string[]): string[] {
  return [...localToolsIn(names), ...studioToolsIn(names), ...memoryToolsIn(names), ...skillToolsIn(names)];
}

/**
 * The run's surface VOCABULARY its prompt does not name: the vocabulary less any the system prompt or the turn names (`promptTools`,
 * recorded by the preamble). A vocabulary tool the prompt names stays required on every turn; the rest is required only on an uncapped
 * turn (see {@link surfaceRequired}).
 */
export function unnamedVocabulary(run: NamingRun): Set<string> {
  const named = new Set([...run.promptTools.system, ...run.promptTools.turn]);
  return new Set(vocabularyOf(run.catalogToolNames).filter((n) => !named.has(n)));
}

/**
 * The tools ONLY the standing system prompt names, outside the surface vocabulary: the board, ticket and close-out tools the persona and
 * the directives (`chatMode.ts`, `chatWorkLinking.ts`, `selfReviewShip.ts`) name for every phase. On an EDITOR surface (it holds the
 * workspace file tools, `canChangeCodeHere`) a capped turn does not require them: they compete on relevance, and a direct call to one
 * still runs (the surface's catalog is closed, so the kernel hands every name to {@link brainPlatformTools}' preflight and execute, which
 * trace it as routed). A surface without the file tools (the web Brain) acts through those very tools, so nothing is demoted there. What
 * the turn names, what a contract the turn carries out names (the Studio's preview review), `ask_user` and `hand_off` are never in this
 * set. A role-set tool needs no exemption: the role cap (`roleCap.ts`) requires its own set whatever this says.
 */
export function promptOnlyNamed(run: NamingRun): Set<string> {
  if (!canChangeCodeHere(run.catalogToolNames)) return new Set();
  const { system, turn, contract } = run.promptTools;
  const kept = new Set([...turn, ...contract, ...vocabularyOf(run.catalogToolNames), ASK_USER_TOOL, HAND_OFF_TOOL]);
  return new Set(system.filter((n) => !kept.has(n)));
}

/** What the run's prompt names, read once: the vocabulary it leaves unnamed, and what only its system prompt names. */
export interface PromptNaming {
  unnamed: ReadonlySet<string>;
  promptOnly: ReadonlySet<string>;
}

/**
 * The required set this turn's selection holds. A code or verify turn is capped (`@builderforce/agent-run` `roleCap.ts`): it requires
 * what the TURN names, the vocabulary the prompt names, `ask_user` and `hand_off`, while its role set keeps the vocabulary a coder needs.
 * The unnamed vocabulary and the tools only the system prompt names compete on relevance (chat #61651: requiring the vocabulary held
 * every VSIX code turn at 54–57 tools; requiring the ~15 board tools the directives name held it at 37). Every other turn keeps the whole
 * `alwaysAdvertised` set, as it always has.
 */
export function surfaceRequired(run: Pick<BrainRunContext, 'alwaysAdvertised' | 'policy' | 'canAskUser'>, naming: () => PromptNaming): Set<string> {
  const base = isCappedToolRole(run.policy.phase)
    ? run.alwaysAdvertised.filter((n) => !naming().unnamed.has(n) && !naming().promptOnly.has(n))
    : run.alwaysAdvertised;
  return new Set(offersHandOff(run.policy) && run.canAskUser ? [...base, HAND_OFF_TOOL] : base);
}

export function brainPlatformTools(run: BrainRunContext): BrainPlatform {
  // The names are the preamble's record (`promptTools`), fixed for the run: derived once.
  let naming: PromptNaming | undefined;
  const named = (): PromptNaming => (naming ??= { unnamed: unnamedVocabulary(run), promptOnly: promptOnlyNamed(run) });
  // The menu a CAPPED turn advertised, by name: a direct call to a catalog tool outside it that the preflight let through is traced as
  // routed (it runs as the router's `invoke` would - the surface's catalog is closed, so the kernel hands it to the preflight and execute).
  let cappedMenu: { step: number; names: ReadonlySet<string> } | undefined;
  const traceUnadvertised = (raw: string, step: number): void => {
    const name = resolveToolAlias(raw);
    if (!cappedMenu || cappedMenu.step !== step || cappedMenu.names.has(name) || isRouterTool(name) || !run.catalogToolNames.includes(name)) return;
    traceRouted(run.c, step, 'direct', name);
  };
  const before = callPreflight(run);
  const dispatch = callRunner(run);
  const after = callPostStep(run);
  // Keyed by the call's id: a call the agent answered itself (a declined, a skipped one) never reaches `execute`, so the rows cannot be matched in order.
  const ran = new Map<string, Ran>();
  // The calls the preflight let through (possibly rewritten by the router), waiting for the dispatch that follows them.
  const prepared = new Map<string, { call: ParsedToolCall; ctx: TurnContext<ChatCompletionMessage> }>();
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
        // it leaves the MENU when planning closes (`brainTurnMenu.ts`).
        return [...catalog, ...conversational.filter((t) => !names.has(t.function.name))];
      },
      get selection() {
        // The pins are the tools THIS run called (`callPostStep`): a tool reached through the router is the tool it reached, a fold does not
        // forget one, and an earlier run's calls pin nothing - the transcript the agent would read them off holds all three wrongly.
        // The ranking stays the Brain's own (`selectTools.ts`), not the shared scorer the cloud and the canvas keep, and the required tools are held to the cap as the Brain's loop always held them.
        // A code or verify turn is capped to what the prompt names, its role's tools and what matches the request (`@builderforce/agent-run`
        // `roleCap.ts`, {@link surfaceRequired}); a Studio keeps its build vocabulary through it. The router rides every trimmed turn (`brainTurnMenu.ts`).
        return { query: run.requestQuery, limit: DEFAULT_TOOL_LIMIT, capRequired: true, role: run.policy.phase, roleKeep: studioToolsIn(run.catalogToolNames), rank: (tools: readonly ToolSchema[], query: string) => relevantTools(tools as unknown as BrainToolSpec[], query) as unknown as ToolSchema[], pinned: [...run.usedTools], required: surfaceRequired(run, named) };
      },
      // ONE cap on a result: the Brain's own, applied inside `callRunner` (`trimToolResult`, by LINE, sized to the serving
      // model's window). The agent's per-tool cap would cut the already budgeted text a second time and drop its paging fields.
      resultCap: () => Number.MAX_SAFE_INTEGER,
      // No `handsOff`: `hand_off` reports itself to the model policy inside `callPreflight` (through the run's view), and a
      // call the agent hands off first would find the plan already closed.
      turn: async (env) => {
        const menu = withRunBrief(run, await brainTurnMenu(run, env, run.allTools?.length ?? 0));
        cappedMenu = isCappedToolRole(run.policy.phase) && menu?.tools ? { step: env.step, names: new Set(menu.tools.map((t) => t.function.name)) } : undefined;
        return menu;
      },
      // A3's detector is the Brain's own (`progressGuard.ts`): the turn is judged when its calls have all run, as the loop does.
      turnEnded: progressAfterToolCalls(run),
      // The turn's step, as the kernel numbers it: the router, the hand-off, the confirm gate, the guards, the activity line and the
      // no-progress streak (`CacheServedStreak` counts distinct TURNS) all stamp it, so it is not a per-call counter.
      // The runner is the Brain's own and watches the person's steers itself (`callRunner`'s `runToolInterruptibly`): a foreground command
      // a steer stops, and a wait it cuts short, come back already encoded and counted as the failed step they are.
      watchesItself: true,
      // The preflight (router, `ask_user`, `hand_off`, confirm gate, dedupe) runs where the loop runs it: ahead of the dispatch, not raced
      // against the person's Stop. A Stop pressed during a hand-off waits for it to end, so its tickets and children are on the trace.
      async preflight(raw, { step }) {
        const { call, ctx } = kernelCall(run, raw.id, raw.name, raw.malformed ? {} : raw.args, step, raw.malformed ? raw.arguments : undefined);
        const pre = await before(call, ctx);
        if (pre && 'result' in pre) {
          ran.set(raw.id, { call, result: pre.result, ctx });
          return { result: pre.result };
        }
        traceUnadvertised(raw.name, step);
        const target = pre && 'rewrite' in pre ? pre.rewrite : call;
        prepared.set(raw.id, { call: target, ctx });
        return pre && 'rewrite' in pre ? { rewrite: { name: target.name, args: target.args } } : undefined;
      },
      async execute(name, args, env): Promise<PlatformToolResult> {
        const id = env.callId ?? `brain-${env.step}-${ran.size + 1}`;
        let held = prepared.get(id);
        prepared.delete(id);
        // Reached without the kernel's preflight (a caller that dispatches directly): the same steps, here.
        let early: PlatformToolResult | undefined;
        if (!held) {
          const fresh = kernelCall(run, id, name, args, env.step);
          const pre = await before(fresh.call, fresh.ctx);
          if (pre && 'result' in pre) early = pre.result;
          else traceUnadvertised(name, env.step);
          held = { call: pre && 'rewrite' in pre ? pre.rewrite : fresh.call, ctx: fresh.ctx };
        }
        const result: PlatformToolResult = early ?? (await dispatch(held.call, held.ctx));
        ran.set(id, { call: held.call, result, ctx: held.ctx });
        return result;
      },
      // A call whose arguments never parsed was already answered by the preflight where it has a corrective of its own (an `ask_user`, a
      // `hand_off`); any other is declined by the shared decline and its trace step. The progress detector sees it either way.
      malformed: {
        roundDirective: () => '',
        answer(raw, { step }) {
          const held = prepared.get(raw.id) ?? kernelCall(run, raw.id, raw.name, {}, step, raw.arguments);
          prepared.delete(raw.id);
          const result = declineMalformedCall(run, held.call) as PlatformToolResult;
          ran.set(raw.id, { call: held.call, result, ctx: held.ctx });
          return result;
        },
      },
    },
  };
}
