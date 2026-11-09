/**
 * What the run has already established, in front of THIS turn only (PRD 35 §4 WS4, parity ruling T6). The Brain restates its
 * own record of what it read and changed (`run.knowledge.brief()`) before every turn that can call tools, so the model reasons
 * from it instead of re-deriving the codebase (its reasoning is stripped from the transcript, and old tool results compact away).
 * The record and a forced turn's brief ride the request in ONE section of the volatile tail, LAST: the cache breakpoint lands
 * before it, and the packer keeps it last without mistaking it for the person's request.
 *
 * The agent joins a turn's tail sections with a line break; the Brain joins them with a blank line. One joined section
 * is how the request carries the Brain's own wording.
 */

import type { TurnMenu } from '@builderforce/agent-run';
import type { BrainRunContext } from '../runStore/brainRunContext';
import { runTrace } from '../runStore/runCells';
import { computeProgressLine } from './progressLine';

/**
 * The host-derived progress line (PRD 45 §4.7 B5): one deterministic line from the
 * run's OWN trace — files changed so far, how many are checked, and what the push
 * gate still needs. A pure function of the recorded trace, so it needs zero model
 * cooperation. Nothing for a turn that offers no tools (or no recorded changes).
 */
export function progressLine(run: BrainRunContext, tools: number): string {
  if (tools <= 0) return '';
  return computeProgressLine(runTrace(run.c));
}

/** The run's record for a turn that offers `tools` of them: nothing for a turn that offers none. */
export function runBrief(run: BrainRunContext, tools: number): string {
  const brief = tools > 0 ? run.knowledge.brief() ?? '' : '';
  const progress = progressLine(run, tools);
  return [brief, progress].map((section) => section.trim()).filter(Boolean).join('\n\n');
}

/** The turn's menu with the run's record at the head of its tail (nothing added to a turn that offers no tools). */
export function withRunBrief(run: BrainRunContext, menu: TurnMenu | void): TurnMenu | void {
  const ledger = runBrief(run, (menu?.tools ?? run.allTools ?? []).length);
  const sections = [ledger, ...(menu?.tail ?? [])].map((section) => (section ?? '').trim()).filter(Boolean);
  if (sections.length === 0) return menu;
  return { ...(menu ?? {}), tail: [sections.join('\n\n')] };
}
