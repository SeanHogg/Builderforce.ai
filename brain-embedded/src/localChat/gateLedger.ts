/**
 * The PreFetch GATE's side of the run usage ledger (PRD 38) — the rows the gate leaves
 * that are not a real model call: an AVOIDED call (a PreFetch ANSWER, its saving
 * `deterministic`) and a run's end with its gate reading (`run-outcome`). Both stay on
 * this device: neither is spend the platform should import.
 */

import { newLocalRecord, type LocalFirstStore } from '@builderforce/local-first';
import { listPriceOf, type PriceBook } from '@builderforce/model-catalog';
import { computeCostMillicents } from '@builderforce/spend-contract';
import type { RunEndOutcome } from '../runStore/runTypes';
import { chatRecordById } from './records';
import { ledgerCount, paidRouteOf, usageRowsOf } from './paidRoute';
import type { RunUsageValue } from './usageLedger';

/** One run's end, as the ledger stores it (`run-outcome` record, local only). */
export interface RunOutcomeValue {
  /** The run id its usage rows carry ({@link RunUsageValue.runId}). */
  runId: string;
  clientChatId: string;
  /** Absent until the run's end is reported (a gate reading can land first). */
  outcome?: RunEndOutcome;
  /** Whether the run's PreFetch decision was accepted — the next request did not re-ask. */
  gateAccepted?: boolean;
  at: string;
}

/** A model call a PreFetch ANSWER stood in for — brain-embedded's `AvoidedRunCall`, with its chat. */
export interface RecordAvoidedCallInput {
  chatId: number;
  runKey: number;
  actionId: string;
  runId?: string;
  /** The model the turn would have run on; absent ⇒ the chat's paid route. */
  model?: string;
  promptTokens: number;
  completionTokens: number;
}

/** A run's end and/or its gate reading, by its run id. */
export interface RecordRunOutcomeInput {
  chatId: number;
  runId: string;
  outcome?: RunEndOutcome;
  gateAccepted?: boolean;
}

/** What the gate's writes need of the ledger they belong to. */
export interface GateLedgerContext {
  store: LocalFirstStore;
  deviceId: string;
  book: () => PriceBook;
  now: () => Date;
  newId: () => string;
}

/**
 * Whether a ledger row is sent to the platform on sync: a call the gateway never saw. A
 * gateway call it logged itself; an AVOIDED call (`deterministic`) is this device's own
 * saving with no real call behind it, which the platform's usage import would count as one.
 */
export function syncsToPlatform(row: Pick<RunUsageValue, 'route' | 'savingsSource'>): boolean {
  return row.route !== 'gateway' && row.savingsSource !== 'deterministic';
}

/**
 * Record an AVOIDED call: a row with zero real tokens whose saving (`deterministic`,
 * estimated) is the turn's tokens priced at `model`, else the chat's paid route. Kept on
 * this device — never journaled, so a sync can never import it as a real call.
 */
export async function recordAvoidedCall(ctx: GateLedgerContext, input: RecordAvoidedCallInput): Promise<void> {
  const savedPrompt = ledgerCount(input.promptTokens);
  const savedCompletion = ledgerCount(input.completionTokens);
  if (savedPrompt + savedCompletion === 0) return;
  await ctx.store.transact(async (tx) => {
    const chat = await chatRecordById(tx, ctx.deviceId, input.chatId);
    if (!chat) return;
    const id = ctx.newId();
    const at = ctx.now().toISOString();
    const named = input.model ? listPriceOf(ctx.book(), input.model) : undefined;
    const pricing = named
      ? { prompt: named.input, completion: named.output }
      : paidRouteOf(await usageRowsOf(tx, ctx.deviceId, chat.id), ctx.book());
    await tx.put(newLocalRecord<RunUsageValue>({
      id,
      entityType: 'usage',
      payload: {
        clientEventId: id,
        clientChatId: chat.id,
        runKey: input.runKey,
        model: input.model ?? 'auto',
        route: 'local',
        ...(input.runId ? { runId: input.runId } : {}),
        promptTokens: 0,
        completionTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        savingsSource: 'deterministic',
        answeredBy: input.actionId,
        savedPrompt,
        savedCompletion,
        savedCostMc: computeCostMillicents(pricing, { promptTokens: savedPrompt, completionTokens: savedCompletion, totalTokens: savedPrompt + savedCompletion }),
        at,
      },
      deviceId: ctx.deviceId,
      destination: chat.destination,
      occurredAt: at,
    }));
  });
}

/** Record how a run ended, once, by its run id. Never journaled: it is this device's own
 *  reading of its runs, not spend. A chat this store does not hold is skipped. */
export async function recordRunOutcome(ctx: GateLedgerContext, input: RecordRunOutcomeInput): Promise<void> {
  if (!input.runId) return;
  await ctx.store.transact(async (tx) => {
    const chat = await chatRecordById(tx, ctx.deviceId, input.chatId);
    if (!chat) return;
    const at = ctx.now().toISOString();
    // The run's end and its gate reading arrive separately; each keeps the other.
    const prior = (await tx.get<RunOutcomeValue>('run-outcome', input.runId))?.payload;
    const outcome = input.outcome ?? prior?.outcome;
    const gateAccepted = input.gateAccepted ?? prior?.gateAccepted;
    await tx.put(newLocalRecord<RunOutcomeValue>({
      id: input.runId,
      entityType: 'run-outcome',
      payload: { runId: input.runId, clientChatId: chat.id, ...(outcome ? { outcome } : {}), ...(gateAccepted !== undefined ? { gateAccepted } : {}), at },
      deviceId: ctx.deviceId,
      destination: chat.destination,
      occurredAt: at,
    }));
  });
}
