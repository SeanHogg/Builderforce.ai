/**
 * The run's USD cap (`BrainRunRequest.maxRunBudgetUsd`, the editor's `builderforce.maxRunBudgetUsd`): the run TREE's one running total.
 *
 * The agent holds a run to the cap (`@builderforce/agent-run` `policy/budget/usd.ts`: the wording, the 80% warning, the contained stop);
 * this is the Brain's part - which total a run accrues into, and how the stop it settles with is saved.
 *
 * The total is the run TREE's, not the run's: a sub-agent (`BrainRunRequest.lineage`) accrues into its owner's total, so an owner and
 * every child it spawns - however deep - are held to ONE cap together. A child never starts a fresh budget of its own, and the owner's
 * figure includes what its children spent. No cap (absent, 0, or not a positive number) means no tree at all.
 */

import { runBudgetCapMillicents } from '@builderforce/agent-run';
import type { RunCell } from './runCell';
import { cells, emit, recordAppended } from './runCells';
import type { RunLoopContext } from './runLoopContext';

/** One run TREE's spend — the owner and every sub-agent under it share one. */
export interface RunSpendTree {
  spentMc: number;
  /** Calls whose price is unknown (not on the device, no price in the book). The cap counts only what is
   *  priced, so a tree with any of these is under-counted — it is flagged, never read as free. */
  unpricedCalls: number;
  /** The cap the tree's root started with; a child is held to the tighter of it and its own. */
  capMc: number;
}

/**
 * Each run's tree, by its cell (weakly — an evicted cell takes its entry with it; a run
 * still going holds its tree in its meter, `run/loopSpend.ts`). A child finds its owner's cell by
 * `lineage.ownerKey` and joins that tree; a top-level run always starts a fresh one.
 */
const spendTrees = new WeakMap<RunCell, RunSpendTree>();

/** The tree `run` accrues into: its owner's when it is a sub-agent of a capped run. */
function runSpendTree(run: Pick<RunLoopContext, 'c' | 'req'>, capMc: number): RunSpendTree {
  const ownerKey = run.req.lineage?.ownerKey;
  const ownerCell = ownerKey !== undefined ? cells.get(ownerKey) : undefined;
  const owned = ownerCell && ownerCell !== run.c ? spendTrees.get(ownerCell) : undefined;
  const tree = owned ?? { spentMc: 0, unpricedCalls: 0, capMc };
  spendTrees.set(run.c, tree);
  return tree;
}

/** The tree `run` joins and the cap it is held to, or null when it is uncapped (its cell then carries no tree, so its children never join a stale one). */
export function joinRunSpend(run: Pick<RunLoopContext, 'c' | 'req'>): { tree: RunSpendTree; capMc: number } | null {
  const ownCapMc = runBudgetCapMillicents(run.req.maxRunBudgetUsd);
  if (ownCapMc == null) {
    spendTrees.delete(run.c);
    return null;
  }
  const tree = runSpendTree(run, ownCapMc);
  return { tree, capMc: Math.min(ownCapMc, tree.capMc) };
}

/**
 * The reply a run ends with when its cap stopped it, saved as the chat's last message and shown: a plain assistant message. It is NOT a
 * settled answer - it carries no provenance chip and the Evermind does not learn from it.
 */
export async function persistBudgetStop(run: Pick<RunLoopContext, 'c' | 'chatId' | 'req'>, text: string): Promise<void> {
  const { c, chatId, req } = run;
  const [msg] = await req.persistence.sendMessages(chatId, [{ role: 'assistant', content: text }]);
  c.streamingText = '';
  if (msg) recordAppended(c, msg);
  emit(c);
  req.onActivity?.(chatId);
}
