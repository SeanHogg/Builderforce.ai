/**
 * What the run has already established, in front of THIS turn only (PRD 35 §4 WS4, parity ruling T6). The Brain's loop restates its
 * own record of what it read and changed (`run.knowledge.brief()`) before every turn that can call tools, so the model reasons
 * from it instead of re-deriving the codebase (its reasoning is stripped from the transcript, and old tool results compact away).
 * The record and a forced turn's brief ride the request in ONE section of the volatile tail, LAST: the cache breakpoint lands
 * before it, and the packer keeps it last without mistaking it for the person's request.
 *
 * The agent joins a turn's tail sections with a line break; the Brain's loop joins them with a blank line. One joined section
 * is how the request carries the Brain's own wording.
 */

import type { TurnMenu } from '@builderforce/agent-run';
import type { RunLoopContext } from '../runStore/runLoopContext';

/** The turn's menu with the run's record at the head of its tail (nothing added to a turn that offers no tools). */
export function withRunBrief(run: RunLoopContext, menu: TurnMenu | void): TurnMenu | void {
  const offered = menu?.tools ?? run.allTools ?? [];
  const ledger = offered.length > 0 ? run.knowledge.brief() : '';
  const sections = [ledger, ...(menu?.tail ?? [])].map((section) => (section ?? '').trim()).filter(Boolean);
  if (sections.length === 0) return menu;
  return { ...(menu ?? {}), tail: [sections.join('\n\n')] };
}
