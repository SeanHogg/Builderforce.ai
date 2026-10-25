/**
 * The RUN USAGE LEDGER (PRD 36 §36.3) — one local row per model call a run made in a
 * local chat, so the chat's spend and savings are known on the device: offline, signed
 * out, and for the calls the platform never sees (a model on this machine).
 *
 * A row is priced only when read, by the ONE fold (`@builderforce/spend-contract`) over
 * the release's bundled price snapshot (`snapshotPriceBook`), so the device and the
 * api's ledger run the same arithmetic. The one figure stamped at write is a local
 * call's counterfactual — what the chat's paid route would have charged for the same
 * tokens — because a local model has no price of its own to read it back from.
 *
 * Gateway calls are journaled nowhere: the gateway already logged them, so sync never
 * sends them twice. Local and direct-provider calls are journaled for sync like the
 * chat's other rows (`journal.ts`).
 */

import { newLocalRecord, type EntityDestination, type LocalFirstStore, type LocalFirstTransaction } from '@builderforce/local-first';
import { isLocalModelRef } from '@builderforce/local-inference';
import { ANTHROPIC_RELEASES, directCatalogId, listPriceOf, snapshotPriceBook, type PriceBook } from '@builderforce/model-catalog';
import {
  computeCostMillicents,
  foldSpendSavings,
  type SpendSavingsSummary,
  type UsageSlice,
} from '@builderforce/spend-contract';
import type { CompletionUsage, StreamChatResult } from '../streamChatCompletion';
import type { BrainStreamFn } from '../runStore/runTypes';
import { isImported, journalWrite } from './journal';
import { chatRecordById, liveRecords } from './records';

/** Where a call ran: through the gateway, on this machine, or straight to a provider. */
export type UsageRoute = 'gateway' | 'local' | 'byo-direct';

/** One model call's usage — the `usage` record's payload, and the sync wire shape. */
export interface RunUsageValue {
  clientEventId: string;
  clientChatId: string;
  /** The run's local key (diagnostics; never resolved off the device). */
  runKey: number;
  model: string;
  route: UsageRoute;
  mode?: 'chat' | 'work';
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  savingsSource?: 'local_model';
  savedPrompt?: number;
  savedCompletion?: number;
  /** A local call's counterfactual at list, in millicents (stamped at write). */
  savedCostMc?: number;
  recallPrompt?: number;
  at: string;
}

/** The paid route a local call is valued against when the chat never used one: the
 *  platform's default coder (the current Sonnet), by its catalog id. */
const DEFAULT_PAID_ROUTE = `anthropic/claude-sonnet-${ANTHROPIC_RELEASES.sonnet[0]}`;

/** Which route served a call, from what the stream reported. */
export function usageRouteOf(result: Pick<StreamChatResult, 'resolvedModel' | 'localFirst'>, requested?: string): UsageRoute {
  if (result.localFirst?.some((attempt) => attempt.outcome === 'served' && isLocalModelRef(attempt.target))) return 'local';
  const model = result.resolvedModel ?? requested ?? '';
  if (isLocalModelRef(model)) return 'local';
  return directCatalogId(model) !== undefined ? 'byo-direct' : 'gateway';
}

const count = (n: number | undefined): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

export interface RecordRunUsageInput {
  /** The chat's local view key. */
  chatId: number;
  runKey: number;
  model: string;
  route: UsageRoute;
  usage: CompletionUsage | undefined;
  mode?: 'chat' | 'work';
}

export interface RunUsageLedgerOptions {
  store: LocalFirstStore;
  deviceId: string;
  /** The book local calls are valued with. Defaults to the bundled snapshot. */
  book?: () => PriceBook;
  now?: () => Date;
  newId?: () => string;
}

export interface RunUsageLedger {
  /** Record one call. A call with no usage, or in a chat this store does not hold, is skipped. */
  record(input: RecordRunUsageInput): Promise<void>;
}

/** What the chat's paid route charges per token: its latest priced gateway call's model, else the default. */
function paidRouteOf(rows: readonly RunUsageValue[], book: PriceBook): { prompt: number; completion: number } | undefined {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (row.route === 'local') continue;
    const price = listPriceOf(book, row.model);
    if (price) return { prompt: price.input, completion: price.output };
  }
  const fallback = listPriceOf(book, DEFAULT_PAID_ROUTE);
  return fallback ? { prompt: fallback.input, completion: fallback.output } : undefined;
}

/** A chat's usage rows, oldest first. */
async function usageRowsOf(tx: LocalFirstTransaction, deviceId: string, clientChatId: string): Promise<RunUsageValue[]> {
  return (await liveRecords<RunUsageValue>(tx, 'usage', deviceId))
    .map((row) => row.payload)
    .filter((row) => row.clientChatId === clientChatId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function createRunUsageLedger(options: RunUsageLedgerOptions): RunUsageLedger {
  const book = options.book ?? snapshotPriceBook;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  return {
    async record(input) {
      const promptTokens = count(input.usage?.prompt);
      const completionTokens = count(input.usage?.completion);
      if (promptTokens + completionTokens === 0) return;
      await options.store.transact(async (tx) => {
        const chat = await chatRecordById(tx, options.deviceId, input.chatId);
        if (!chat) return;
        const id = newId();
        const at = now().toISOString();
        let value: RunUsageValue = {
          clientEventId: id,
          clientChatId: chat.id,
          runKey: input.runKey,
          model: input.model,
          route: input.route,
          ...(input.mode ? { mode: input.mode } : {}),
          promptTokens,
          completionTokens,
          cacheReadTokens: Math.min(count(input.usage?.cacheRead), promptTokens),
          cacheCreationTokens: Math.min(count(input.usage?.cacheCreation), promptTokens),
          at,
        };
        if (input.route === 'local') {
          const pricing = paidRouteOf(await usageRowsOf(tx, options.deviceId, chat.id), book());
          value = {
            ...value,
            savingsSource: 'local_model',
            savedPrompt: promptTokens,
            savedCompletion: completionTokens,
            savedCostMc: computeCostMillicents(pricing, { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }),
          };
        }
        const record = newLocalRecord<RunUsageValue>({
          id,
          entityType: 'usage',
          payload: value,
          deviceId: options.deviceId,
          destination: chat.destination,
          occurredAt: at,
        });
        await tx.put(record);
        // The gateway logged its own call; only the calls it never saw are synced.
        if (input.route !== 'gateway') {
          await journalWrite(tx, record, 'create', { key: `usage:${id}`, dependsOn: [`chat:${chat.id}`], chatClientId: chat.id });
        }
      });
    },
  };
}

/**
 * A run's streamer that records every call it made into the ledger — the ONE seam each
 * local-first surface wraps its transport with (the panel's run host, the native chat
 * participant), so no call a run makes, compaction included, is left off the chat's
 * spend. Recording is fire-and-forget: a ledger write never holds or fails a turn.
 */
export function withRunUsage(
  stream: BrainStreamFn,
  ledger: RunUsageLedger,
  context: { chatId: number; runKey: number; mode?: 'chat' | 'work' },
  onError: (error: unknown) => void = () => undefined,
): BrainStreamFn {
  return async (opts, handlers) => {
    const result = await stream(opts, handlers);
    void ledger.record({
      chatId: context.chatId,
      runKey: context.runKey,
      model: result.resolvedModel ?? opts.model ?? 'auto',
      route: usageRouteOf(result, opts.model),
      usage: result.usage,
      ...(context.mode ? { mode: context.mode } : {}),
    }).catch(onError);
    return result;
  };
}

/** One ledger row as a fold slice. A gateway call is priced from `book` (an estimate). */
function sliceOf(row: RunUsageValue, book: PriceBook): UsageSlice {
  const total = row.promptTokens + row.completionTokens;
  const local = row.savingsSource === 'local_model';
  const price = local ? undefined : book.priceOf(row.model);
  return {
    model: row.model,
    byo: row.route === 'byo-direct',
    savingsSource: local ? 'local_model' : null,
    savingsEstimated: local,
    prompt: row.promptTokens,
    completion: row.completionTokens,
    cacheRead: row.cacheReadTokens,
    cacheCreation: row.cacheCreationTokens,
    total,
    costMc: row.route === 'gateway' && price
      ? computeCostMillicents({ prompt: price.input, completion: price.output }, {
          promptTokens: row.promptTokens, completionTokens: row.completionTokens, totalTokens: total,
          cacheReadTokens: row.cacheReadTokens, cacheCreationTokens: row.cacheCreationTokens,
        })
      : 0,
    calls: 1,
    cacheCalls: row.cacheReadTokens > 0 ? 1 : 0,
    savedPrompt: row.savedPrompt ?? 0,
    savedCompletion: row.savedCompletion ?? 0,
    recallPrompt: row.recallPrompt ?? 0,
    savedCostMc: row.savedCostMc ?? 0,
    trimCalls: 0,
    recallCalls: 0,
    rows: 1,
  };
}

/**
 * A local chat's spend from its ledger rows (§3.2). `excludeGateway` = the platform's
 * figure for this chat is being added, so the rows it already accounts for are left
 * out and counted once, not twice: its gateway calls, and the calls a sync import
 * put on the platform (`imported`, by `clientEventId`). A figure that priced any
 * gateway call on the device is an estimate.
 */
export function ledgerSpend(
  rows: readonly RunUsageValue[],
  opts: { excludeGateway: boolean; imported?: ReadonlySet<string>; book?: PriceBook },
): SpendSavingsSummary | null {
  const book = opts.book ?? snapshotPriceBook();
  const kept = opts.excludeGateway
    ? rows.filter((row) => row.route !== 'gateway' && !opts.imported?.has(row.clientEventId))
    : rows;
  if (kept.length === 0) return null;
  const summary = foldSpendSavings(kept.map((row) => sliceOf(row, book)), book);
  return kept.some((row) => row.route === 'gateway') ? { ...summary, spend: { ...summary.spend, estimated: true } } : summary;
}

/** Of a chat's ledger rows, the ones a sync receipt says the platform imported. */
export async function importedUsageIds(
  tx: LocalFirstTransaction,
  rows: readonly RunUsageValue[],
  destination: EntityDestination,
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.route !== 'gateway' && isImported(await tx.mapping('usage', row.clientEventId, destination))) ids.add(row.clientEventId);
  }
  return ids;
}

/** Every chat's ledger rows, by chat client id — one read for a whole chat list. */
export async function usageRowsByChat(tx: LocalFirstTransaction, deviceId: string): Promise<Map<string, RunUsageValue[]>> {
  const byChat = new Map<string, RunUsageValue[]>();
  for (const row of await liveRecords<RunUsageValue>(tx, 'usage', deviceId)) {
    const list = byChat.get(row.payload.clientChatId) ?? [];
    list.push(row.payload);
    byChat.set(row.payload.clientChatId, list);
  }
  return byChat;
}
