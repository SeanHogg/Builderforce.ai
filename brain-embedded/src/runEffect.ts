/**
 * A run's EFFECT vocabulary, split from `runProgress.ts` (which measures the run with it): what the person asked for (a change,
 * board work) and which calls count as changing something.
 *
 * A change request is answered by a change. Board bookkeeping — filing a ticket, moving it, updating a task
 * (`workItemBookkeeping.ts`) — is a mutation, but never the change itself: VS Code chat #165961 asked to "fix the regression … Add
 * unit tests", wrote no file, filed and moved one ticket, and was scored "healthy" because the ticket write counted as its effect.
 * A bookkeeping write is the effect only when the person asked for the board work ({@link asksForWorkItemsIn}).
 */

import { asksForChange } from '@builderforce/agent-stall';
import { isCodeChangeTool } from './localWorkspaceTools';
import { asksForWorkItems, isWorkItemWrite } from './workItemBookkeeping';
import type { BrainMessage } from './types';

/** Tools that MUTATE something — the run's "did it have an effect" evidence.
 *  Covers the IDE workspace writers (`isCodeChangeTool`) plus the gateway's
 *  builtin create/update/write/save/delete family, matched structurally so a new
 *  create tool counts without an edit here. Read-only `*_list` / `*_get` /
 *  `*_search` names can't match. */
const MUTATION_TOOL = /(^|_)(write|edit|save|create|update|delete|apply|patch|publish|send|dispatch|run_command|assign|link|move|set)(_|$)/i;

export function isMutationTool(name: string): boolean {
  // The device's hyphenated ticket writes (`ticket-create`, `ticket-move`) are mutations too: the verb pattern above needs `_`.
  return isCodeChangeTool(name) || MUTATION_TOOL.test(name) || isWorkItemWrite(name);
}

/** A mutation that only records work on the board (a ticket / task / kanban write): never a change request's effect on its own. */
export function isBookkeepingWrite(name: string): boolean {
  return !isCodeChangeTool(name) && isWorkItemWrite(name);
}

/**
 * Whether the run was asked to CHANGE something. Reads the user turns only — the
 * assistant's own restatement of the task would make this trivially self-fulfilling.
 * Uses the first user turn (the request) plus any later one, since a follow-up can
 * turn a question into a task.
 *
 * The per-message predicate is `asksForChange` from `@builderforce/agent-stall`: the
 * SERVER needs the identical judgement to decide whether an answer may be replayed
 * from cache (a change request must never be), so it cannot live here.
 */
export function hasEditIntent(messages: BrainMessage[]): boolean {
  return messages.some((m) => m.role === 'user' && asksForChange(m.content));
}

/** Whether a user turn asked for board work itself (filing tickets / tasks): then a bookkeeping write IS the effect. */
export function asksForWorkItemsIn(messages: BrainMessage[]): boolean {
  return messages.some((m) => m.role === 'user' && asksForWorkItems(m.content));
}
