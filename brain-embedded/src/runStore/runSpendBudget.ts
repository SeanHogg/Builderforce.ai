/**
 * The run's USD cap (`BrainRunRequest.maxRunBudgetUsd`, the editor's
 * `builderforce.maxRunBudgetUsd`) — two loop hooks over ONE running total.
 *
 *   - `afterTurn` adds what the turn's call cost, priced on the device
 *     (`localChat/callCost.ts`).
 *   - `beforeTurn` holds the run to the cap with the SAME rule the cloud cost loop uses
 *     (`@builderforce/spend-contract` `runBudget.ts`): at 80% the model is told once to
 *     converge; at the cap the run stops with a contained outcome — a reply that says
 *     what it spent and why it stopped, never an error.
 *
 * The total is the run TREE's, not the run's: a sub-agent (`BrainRunRequest.lineage`)
 * accrues into its owner's total, so an owner and every child it spawns — however deep —
 * are held to ONE cap together. A child never starts a fresh budget of its own, and the
 * owner's figure includes what its children spent.
 *
 * The 80% warning is a `<run-state>` volatile block (`@seanhogg/builderforce-memory/handoff`),
 * never an untagged user turn: the packer must not mistake it for the person's request.
 *
 * No cap (absent, 0, or not a positive number) ⇒ no hooks at all, so an uncapped run is
 * exactly the loop it always was.
 */

import type { LoopHooks, StopDecision } from '@builderforce/agent-loop';
import { volatileTail } from '@seanhogg/builderforce-memory/handoff';
import { MILLICENTS_PER_USD, runBudgetBreach, runBudgetWarnDue, type RunBudgetCaps } from '@builderforce/spend-contract';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import type { PriceBook } from '@builderforce/model-catalog';
import { callCostOrUnknown } from '../localChat/callCost';
import { servedModel, usageRouteOf } from '../localChat/usageLedger';
import type { RunCell } from './runCell';
import { cells, emit, nowIso, pushTrace, recordAppended } from './runCells';
import { noteBudgetContained } from './runEndOutcome';
import type { RunLoopContext, TurnMeta } from './runLoopContext';

type SpendHooks = Pick<LoopHooks<ChatCompletionMessage>, 'beforeTurn' | 'afterTurn'>;

const usd = (millicents: number): string => `$${(millicents / MILLICENTS_PER_USD).toFixed(2)}`;

/** The cap in millicents, or null when the run is uncapped. */
export function runBudgetCapMillicents(maxRunBudgetUsd: number | undefined): number | null {
  return typeof maxRunBudgetUsd === 'number' && Number.isFinite(maxRunBudgetUsd) && maxRunBudgetUsd > 0
    ? Math.round(maxRunBudgetUsd * MILLICENTS_PER_USD)
    : null;
}

/** What the model reads once the run has used 80% of its budget. */
export function budgetWarning(spentMc: number, capMc: number): string {
  return `[Run budget] This run has spent ${usd(spentMc)} of its ${usd(capMc)} budget — over 80%. Stop exploring and converge: `
    + 'finish the essential change now, then answer with what you did and exactly what is left.';
}

/** The reply a run stopped at its cap settles with. */
export function budgetContainedReply(spentMc: number, capMc: number): string {
  return `Run stopped: it reached its ${usd(capMc)} spend budget (${usd(spentMc)} spent). `
    + 'Nothing was rolled back — the changes made so far are in place. Ask to continue to resume from here, '
    + 'or raise the "builderforce.maxRunBudgetUsd" setting (0 turns the cap off).';
}

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
 * still going holds its tree in its hooks). A child finds its owner's cell by
 * `lineage.ownerKey` and joins that tree; a top-level run always starts a fresh one.
 */
const spendTrees = new WeakMap<RunCell, RunSpendTree>();

/** The tree `run` accrues into: its owner's when it is a sub-agent of a capped run. */
export function runSpendTree(run: Pick<RunLoopContext, 'c' | 'req'>, capMc: number): RunSpendTree {
  const ownerKey = run.req.lineage?.ownerKey;
  const ownerCell = ownerKey !== undefined ? cells.get(ownerKey) : undefined;
  const owned = ownerCell && ownerCell !== run.c ? spendTrees.get(ownerCell) : undefined;
  const tree = owned ?? { spentMc: 0, unpricedCalls: 0, capMc };
  spendTrees.set(run.c, tree);
  return tree;
}

/** `book` prices the calls — the bundled snapshot unless a test lends one. */
export function runSpendBudget(run: RunLoopContext, book?: PriceBook): SpendHooks {
  const ownCapMc = runBudgetCapMillicents(run.req.maxRunBudgetUsd);
  if (ownCapMc == null) {
    // An uncapped run's cell carries no tree, so its children never join a stale one.
    spendTrees.delete(run.c);
    return {};
  }
  const tree = runSpendTree(run, ownCapMc);
  const capMc = Math.min(ownCapMc, tree.capMc);
  const caps: RunBudgetCaps = { maxSpendMillicents: capMc };
  // Each run of the tree is told once — each is a model that must converge.
  let warned = false;
  let unpricedNoted = false;

  /** A call the cap cannot price: counted on the tree, and said once in this run's trace. */
  const noteUnpriced = (model: string | undefined): void => {
    tree.unpricedCalls += 1;
    if (unpricedNoted) return;
    unpricedNoted = true;
    pushTrace(run.c, {
      ts: nowIso(),
      category: 'message',
      label: 'run.budget_unpriced',
      args: { model: model ?? null },
      result: 'A call had no known price, so the run cap counts only the spend that is priced.',
    });
  };

  const contain = async (): Promise<StopDecision> => {
    const { c, chatId, convo, req } = run;
    const spentMc = tree.spentMc;
    const text = budgetContainedReply(spentMc, capMc);
    noteBudgetContained(c);
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'run.budget_contained',
      args: { spentMillicents: spentMc, capMillicents: capMc, unpricedCalls: tree.unpricedCalls },
      result: text,
    });
    convo.push({ role: 'assistant', content: text });
    const [msg] = await req.persistence.sendMessages(chatId, [{ role: 'assistant', content: text }]);
    c.streamingText = '';
    if (msg) recordAppended(c, msg);
    emit(c);
    req.onActivity?.(chatId);
    return { action: 'stop', ok: true, finished: true, output: text };
  };

  return {
    async beforeTurn() {
      const spentMc = tree.spentMc;
      const usage = { spendMillicents: spentMc };
      if (runBudgetBreach(caps, usage)) return contain();
      if (!warned && runBudgetWarnDue(caps, usage)) {
        warned = true;
        const warning = budgetWarning(spentMc, capMc);
        // Tagged `<run-state>`: the packer keeps it out of "the latest user directive" and
        // the cache breakpoint lands before it, as for the turn's own volatile tail.
        run.convo.push(volatileTail([warning])!);
        pushTrace(run.c, { ts: nowIso(), category: 'message', label: 'run.budget_warning', args: { spentMillicents: spentMc, capMillicents: capMc }, result: warning });
      }
      return undefined;
    },
    afterTurn(_ctx, turn) {
      const meta = turn.meta as TurnMeta | undefined;
      if (!meta) return;
      const usage = meta.result.usage;
      const route = usageRouteOf(meta.result, meta.requested);
      const model = servedModel(meta.result, meta.requested);
      // A turn that reported no usage cannot be priced: off the device it is an UNPRICED call (as the run tally
      // reads it), never free; a call the device answered costs nothing whatever it reported.
      if (!usage) {
        if (route !== 'local') noteUnpriced(model);
        return;
      }
      // The ONE device cost rule, by where the call ran (a local-first serve costs nothing), pricing the SAME
      // served model its route came from. A call with no known price is counted as unpriced, not as free.
      const cost = callCostOrUnknown(model, {
        prompt: usage.prompt ?? 0,
        completion: usage.completion ?? 0,
        cacheRead: usage.cacheRead ?? 0,
        cacheCreation: usage.cacheCreation ?? 0,
      }, book, route);
      if (cost === undefined) noteUnpriced(model);
      else tree.spentMc += cost;
    },
  };
}
