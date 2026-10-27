/**
 * What ONE turn offers the model: the relevance-selected tool menu, or — when a progress
 * rule decides this turn (`progressBudget.ts`, `cacheServedStreak.ts`) — the forced
 * turn's narrower menu, its required call and the brief that rides the request. Split out
 * of the model port (`completeTurn.ts`), which asks for the turn this decides.
 */

import { offersHandOff } from '@builderforce/run-policy';
import type { BrainToolSpec } from '../streamChatCompletion';
import { selectToolsForTurn } from '../selectTools';
import { routerToolSpecs } from '../toolRouter';
import { HAND_OFF_TOOL } from '../planHandoff';
import { nowIso, pushTrace } from './runCells';
import { userTextOf } from './convoText';
import { changeBudgetTurn, planBudgetTurn, type ForcedTurn } from './progressBudget';
import { noProgressTurn } from './cacheServedStreak';
import type { RunLoopContext } from './runLoopContext';

export interface TurnMenu {
  /** The turn a progress rule decided, or null for an ordinary turn. */
  forced: ForcedTurn | null;
  /** Every tool this turn advertises (possibly none). */
  advertised: BrainToolSpec[];
  /** `advertised`, or undefined when it is empty — what the request sends. */
  tools: BrainToolSpec[] | undefined;
  /** What the model could actually call THIS turn — see `narratedUnadvertised`. */
  advertisedNames: Set<string>;
  /** What the turn's FIRST request carries beyond the transcript: a forced turn's brief. */
  opening: string[];
}

/** Decide turn `step`'s menu. Advances the policy when a progress rule fires. */
export function turnMenu(run: RunLoopContext, step: number): TurnMenu {
  const { c, allTools, requestQuery, usedTools, canAskUser, alwaysAdvertised } = run;
  // Analysis that has spent its budget ends HERE, BEFORE selection: the hand-off turn
  // offers `hand_off` alone with a call required, and a forced turn that still did not
  // hand off ends planning, so this turn already selects as code.
  const handOffTurn = planBudgetTurn(run, step);
  // Advertise a RELEVANT subset rather than the whole catalog. ~300 tool
  // definitions push most providers past the point where they reliably emit any
  // tool call at all (observed: 308 tools → three consecutive turns with zero
  // calls), besides dominating the prompt budget. No-ops for small catalogs.
  const selection = selectToolsForTurn(allTools, {
    // The REQUEST, captured once before the loop — never "the latest user message".
    // The loop pushes its own `role:'user'` turns (the stall-recovery nudge, the
    // tool-budget close-out), so reading the newest one re-rolled the advertised
    // set from text WE wrote: after one recovery the query became "…made zero tool
    // calls… answer using its result…", which scores `key_results`/`dashboards`/
    // `incidents` and drops the ticket tools the user actually asked for. The tool
    // the model was told to call then genuinely did not exist, and it narrated.
    // Holding the request steady also keeps the advertised set STABLE across turns
    // — a tool must not vanish between one turn and the next.
    query: requestQuery,
    pinned: usedTools,
    // Tools the SYSTEM PROMPT instructs the model to call (e.g. the chat↔ticket
    // directive names `builtin_chats_list_tickets`) are never optional: telling a
    // model to call a tool we then decline to advertise is the exact contradiction
    // that produces a narrated call. Derived from the prompt text, so a directive
    // edit can never silently desync from this list — plus the local workspace
    // tools, which the prompt names in prose the pattern cannot see.
    // While planning, the planner's deliverable is never off-topic either.
    required: offersHandOff(run.policy) && canAskUser ? [...alwaysAdvertised, HAND_OFF_TOOL] : alwaysAdvertised,
  });
  // Once the run is coding, the plan is handed off: `hand_off` is gone from the menu,
  // so a coder can never re-plan the work it was just given.
  const selected = offersHandOff(run.policy) ? selection.tools : selection.tools.filter((t) => t.function.name !== HAND_OFF_TOOL);
  // Coding that has spent its budget without changing anything is made to change
  // something on THIS turn — the change tools alone — and a run circling its own read
  // cache is made to hand off or change now, whatever its budget says.
  const forced = handOffTurn ?? changeBudgetTurn(run, step, selected) ?? noProgressTurn(run, step, selected);
  // A forced turn keeps its OWN, narrower list (and so misses the cached tools prefix for
  // that one turn — at most a few times a run) rather than the full list restricted
  // through `tool_choice`: the vendor path cannot express the restriction. A multi-tool
  // subset (the change tools + `ask_user`) has no portable `tool_choice` at all, and a
  // named single tool is downgraded to `auto` by the direct-Anthropic models that reject
  // forced tool use (Sonnet 5.5, Opus 5.5, Fable — `forcedToolChoice: false` in vendors/
  // anthropic.ts), which would let a forced hand-off turn simply keep reading.
  // The ROUTER rides along whenever selection actually trimmed something, so the tools
  // that missed the cut stay REACHABLE instead of silently ceasing to exist. Three fixed
  // schemas buy back the whole catalog; see toolRouter.ts.
  const advertised = forced
    ? forced.tools
    : selection.trimmed
      ? [...selected, ...routerToolSpecs(allTools?.length ?? 0)]
      : selected;
  if (selection.trimmed && !forced) {
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'tools.selected',
      args: { step },
      result: `${selected.length} of ${selection.available} tools advertised this turn (relevance-selected; ${usedTools.size} pinned from earlier calls)`,
    });
  }
  return {
    forced,
    advertised,
    tools: advertised.length > 0 ? advertised : undefined,
    advertisedNames: new Set(advertised.map((t) => t.function.name)),
    // Every retry of the same turn sends it again, or a forced turn would retry with no
    // instruction. It rides the turn's tagged volatile tail, never as a message of its own.
    opening: forced ? [userTextOf(forced.brief)] : [],
  };
}
