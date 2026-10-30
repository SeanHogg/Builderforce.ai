/**
 * The RUN USAGE LEDGER (PRD 36 §36.3) — one local row per model call a run made in a
 * local chat, so the chat's spend and savings are known on the device: offline, signed
 * out, and for the calls the platform never sees (a model on this machine).
 *
 * A row is priced only when read, by the ONE fold (`ledgerSpend.ts`) over the release's
 * bundled price snapshot (`snapshotPriceBook`), so the device and the api's ledger run
 * the same arithmetic. The one figure stamped at write is a local call's counterfactual
 * — what the chat's paid route would have charged for the same tokens (`paidRoute.ts`)
 * — because a local model has no price of its own to read it back from. The PreFetch
 * gate's rows (an avoided call, a run's outcome) are `gateLedger.ts`.
 *
 * Gateway calls are journaled nowhere: the gateway already logged them, so sync never
 * sends them twice. Local and direct-provider calls are journaled for sync like the
 * chat's other rows (`journal.ts`).
 */

import { newLocalRecord, type LocalFirstStore } from '@builderforce/local-first';
import { servedIdentity } from '@builderforce/local-inference';
import { offDeviceRouteOf } from './callCost';
import { snapshotPriceBook, type PriceBook } from '@builderforce/model-catalog';
import { computeCostMillicents } from '@builderforce/spend-contract';
import type { CompletionUsage, StreamChatResult } from '../streamChatCompletion';
import type { BrainStreamFn } from '../runStore/runTypes';
import { journalWrite } from './journal';
import { chatRecordById } from './records';
import { ledgerCount as count, paidRouteOf, usageRowsOf } from './paidRoute';
import {
  recordAvoidedCall,
  recordRunOutcome,
  syncsToPlatform,
  type GateLedgerContext,
  type RecordAvoidedCallInput,
  type RecordRunOutcomeInput,
} from './gateLedger';

/**
 * Where a call ran — its TRANSPORT: through the gateway, on this machine, or straight to
 * a provider. Not the run's pipeline route (`full` / `quick`), which is
 * {@link RunUsageValue.pipelineRoute}.
 */
export type UsageRoute = 'gateway' | 'local' | 'byo-direct';

/** The run's pipeline route, as the ledger stores it (`@builderforce/pipeline-route`). */
export type UsagePipelineRoute = 'full' | 'quick';

/** One model call's usage — the `usage` record's payload, and the sync wire shape. */
export interface RunUsageValue {
  clientEventId: string;
  clientChatId: string;
  /** The run's local key (diagnostics; never resolved off the device). */
  runKey: number;
  model: string;
  /** The call's transport (see {@link UsageRoute}) — not its pipeline route. */
  route: UsageRoute;
  mode?: 'chat' | 'work';
  /** What kind of call it was (plan / code / verify / explore / chat / utility). */
  role?: string;
  /** The run's pipeline route and the router's score, when the run was routed. */
  pipelineRoute?: UsagePipelineRoute;
  routeScore?: number;
  /** How the PreFetch gate left the run's turn (`metadata.gateRoute`) — the route
   *  report's gate column. An ANSWERED turn is its `deterministic` row instead. */
  gateRoute?: 'prefetch' | 'llm';
  /** The run (one user submit) the call belongs to — what the route report groups by.
   *  A chat's runs share its {@link runKey}, so the key alone cannot tell them apart. */
  runId?: string;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** `local_model`: a call on this machine. `deterministic`: a call AVOIDED — a PreFetch
   *  ANSWER (`recordAvoided`); zero real tokens, a median turn saved. */
  savingsSource?: 'local_model' | 'deterministic';
  /** The PreFetch action that answered a `deterministic` row. */
  answeredBy?: string;
  savedPrompt?: number;
  savedCompletion?: number;
  /** A local call's counterfactual at list, in millicents (stamped at write). */
  savedCostMc?: number;
  recallPrompt?: number;
  at: string;
}

/**
 * The model that answered a call — the ONE name its route, its price and its ledger row all come from
 * (`servedIdentity`). The model that was merely ASKED FOR stands in only when the result says nothing of how
 * the call was served: no served attempt AND no resolved model. Once an attempt served, an unnamed answer
 * (a gateway placeholder with nothing resolved) stays unnamed — the request must not name a call the
 * cloud answered.
 */
export function servedModel(result: Pick<StreamChatResult, 'resolvedModel' | 'localFirst'>, requested?: string): string | undefined {
  const identity = servedIdentity(result);
  return identity.name ?? (identity.viaAttempt ? undefined : requested);
}

/** Which route served a call, from what the stream reported. */
export function usageRouteOf(result: Pick<StreamChatResult, 'resolvedModel' | 'localFirst'>, requested?: string): UsageRoute {
  // 'local' ONLY for a call the device answered (the one rule, `servedOnDevice`): a call that merely asked
  // for a local model and was answered elsewhere is not the device's free work.
  if (servedIdentity(result).onDevice) return 'local';
  // Off the device: a hosted local-grammar runtime (Kimi Code) or a direct id is the person's own account
  // (counts against the cap, books no local saving), anything else the gateway — one rule, `offDeviceRouteOf`.
  return offDeviceRouteOf(servedModel(result, requested) ?? '');
}

export interface RecordRunUsageInput {
  /** The chat's local view key. */
  chatId: number;
  runKey: number;
  model: string;
  route: UsageRoute;
  usage: CompletionUsage | undefined;
  mode?: 'chat' | 'work';
  role?: string;
  pipelineRoute?: UsagePipelineRoute;
  routeScore?: number;
  gateRoute?: 'prefetch' | 'llm';
  runId?: string;
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
  /**
   * Record an AVOIDED call: a row with zero real tokens whose saving (`deterministic`,
   * estimated) is the turn's tokens priced at `model`, else the chat's paid route. Kept on
   * this device — never journaled, so a sync can never import it as a real call.
   */
  recordAvoided(input: RecordAvoidedCallInput): Promise<void>;
  /** Record how a run ended, once, by its run id. Never journaled: it is this device's
   *  own reading of its runs, not spend. A chat this store does not hold is skipped. */
  recordOutcome(input: RecordRunOutcomeInput): Promise<void>;
}

/** The call's role, pipeline route, score and run id — only the fields that are set and valid. */
function runAttribution(input: Pick<RecordRunUsageInput, 'role' | 'pipelineRoute' | 'routeScore' | 'gateRoute' | 'runId'>): Pick<RunUsageValue, 'role' | 'pipelineRoute' | 'routeScore' | 'gateRoute' | 'runId'> {
  return {
    ...(input.role ? { role: input.role } : {}),
    ...(input.pipelineRoute === 'full' || input.pipelineRoute === 'quick' ? { pipelineRoute: input.pipelineRoute } : {}),
    ...(input.gateRoute === 'prefetch' || input.gateRoute === 'llm' ? { gateRoute: input.gateRoute } : {}),
    ...(typeof input.routeScore === 'number' && Number.isFinite(input.routeScore) ? { routeScore: input.routeScore } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
  };
}

export function createRunUsageLedger(options: RunUsageLedgerOptions): RunUsageLedger {
  const ctx: GateLedgerContext = {
    store: options.store,
    deviceId: options.deviceId,
    book: options.book ?? snapshotPriceBook,
    now: options.now ?? (() => new Date()),
    newId: options.newId ?? (() => crypto.randomUUID()),
  };
  return {
    async record(input) {
      const promptTokens = count(input.usage?.prompt);
      const completionTokens = count(input.usage?.completion);
      if (promptTokens + completionTokens === 0) return;
      await ctx.store.transact(async (tx) => {
        const chat = await chatRecordById(tx, ctx.deviceId, input.chatId);
        if (!chat) return;
        const id = ctx.newId();
        const at = ctx.now().toISOString();
        let value: RunUsageValue = {
          clientEventId: id,
          clientChatId: chat.id,
          runKey: input.runKey,
          model: input.model,
          route: input.route,
          ...(input.mode ? { mode: input.mode } : {}),
          ...runAttribution(input),
          promptTokens,
          completionTokens,
          cacheReadTokens: Math.min(count(input.usage?.cacheRead), promptTokens),
          cacheCreationTokens: Math.min(count(input.usage?.cacheCreation), promptTokens),
          at,
        };
        if (input.route === 'local') {
          const pricing = paidRouteOf(await usageRowsOf(tx, ctx.deviceId, chat.id), ctx.book());
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
          deviceId: ctx.deviceId,
          destination: chat.destination,
          occurredAt: at,
        });
        await tx.put(record);
        // The gateway logged its own call; only the calls it never saw are synced.
        if (syncsToPlatform(value)) {
          await journalWrite(tx, record, 'create', { key: `usage:${id}`, dependsOn: [`chat:${chat.id}`], chatClientId: chat.id });
        }
      });
    },

    recordAvoided: (input) => recordAvoidedCall(ctx, input),

    recordOutcome: (input) => recordRunOutcome(ctx, input),
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
    // The call's role and the run's pipeline route ride the request itself (the role on
    // the body, the route in the metadata the gateway stamps on its own row), so the
    // device's row says what the platform's says.
    void ledger.record({
      chatId: context.chatId,
      runKey: context.runKey,
      model: servedModel(result, opts.model) ?? 'auto',
      route: usageRouteOf(result, opts.model),
      usage: result.usage,
      ...(context.mode ? { mode: context.mode } : {}),
      ...(opts.role ? { role: opts.role } : {}),
      ...(opts.metadata?.pipelineRoute ? { pipelineRoute: opts.metadata.pipelineRoute } : {}),
      ...(opts.metadata?.routeScore !== undefined ? { routeScore: opts.metadata.routeScore } : {}),
      ...(opts.metadata?.gateRoute ? { gateRoute: opts.metadata.gateRoute } : {}),
      ...(opts.metadata?.guestTurnId ? { runId: opts.metadata.guestTurnId } : {}),
    }).catch(onError);
    return result;
  };
}
