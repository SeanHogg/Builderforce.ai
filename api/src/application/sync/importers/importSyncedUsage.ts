/**
 * PRD 36.4 — import one model call the platform never saw.
 *
 * A VS Code chat that ran on this machine's model (route `local`) or straight on the
 * person's own provider key (route `byo-direct`) leaves no `llm_usage_log` row: the
 * gateway was never asked. The client ledger records every call; on sync, the calls
 * the server could not observe arrive here and become ONE usage row each, written
 * through the canonical ledger writer, attributed to the chat they served.
 *
 * NEVER TWICE. A `gateway` row is already on the server — the gateway logged it when
 * it served the call — so it is refused (`usage_server_observed`). And because the
 * usage ledger lives in a different database than the push's unit of work, a retry
 * cannot be deduped by the sync transaction alone: the row carries the idempotency
 * key `sync-usage:<clientEventId>`, which a unique index holds to one row (a retry's
 * write is a no-op). A write that FAILS is answered pending — retried, never applied.
 *
 * WHO PAID. Both routes are tenant-funded on the person's own machine, so the row is
 * `byo` on surface `vsix`: zero platform cost and exempt from the plan allowance, the
 * same rule own-machine BYO usage already follows. A local call's saving — what the
 * same tokens would have cost on the chat's paid route — was priced by the client at
 * list (there is no catalog price for a local model) and is written as stamped,
 * marked estimated.
 *
 * Immutable: a call that happened does not change. The projection is the payload
 * verbatim, so a pull round-trips it unchanged.
 */

import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { normalizeByoProvider, SYNC_USAGE_IDEMPOTENCY_PREFIX } from '../../llm/usageLedger';
import { readPipelineAttribution, type PipelineAttribution } from '../../llm/pipelineRouteAttribution';
import type { SyncEventInput, SyncImportContext, SyncStoreSet, SyncUsageLedger } from '../syncPorts';
import {
  appliedExisting,
  appliedNew,
  clampedClientTime,
  conflict,
  mappedChat,
  pending,
  preludeRejection,
  rejected,
  type BoundedImportOutcome,
} from './index';

const ROUTES = new Set(['gateway', 'local', 'byo-direct']);
const MODES = new Set(['chat', 'work']);
/** `llm_usage_log.model` is varchar(200). */
const MODEL_MAX = 200;
/** `llm_usage_log.role` is varchar(16). */
const ROLE_MAX = 16;

export const USAGE_USE_CASE = 'vsix-local-usage';

interface UsageFields {
  clientEventId: string;
  clientChatId: string | null;
  model: string;
  route: 'gateway' | 'local' | 'byo-direct';
  mode: 'chat' | 'work' | null;
  /** The call's role and the run's pipeline route / score (`RunUsageValue`), when stamped. */
  role: string | null;
  pipeline: PipelineAttribution;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  localSaving: { savedPrompt: number; savedCompletion: number; recallPrompt: number; savedCostMc: number } | null;
  at: unknown;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; detail: string };

/** A token count: a non-negative integer, else 0 (an estimate never turns into NaN). */
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
/**
 * No real call reports more. Bounding each count keeps every column (and their sum) in
 * `integer` range, so a bad payload is REJECTED here instead of failing the write — a
 * failed write is answered pending, and a write that can never succeed would be retried
 * forever.
 */
const MAX_TOKENS = 100_000_000;

function readUsage(payload: unknown, clientEntityId: string): Parsed<UsageFields> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, detail: 'payload_invalid' };
  const raw = payload as Record<string, unknown>;
  if (typeof raw.model !== 'string' || raw.model.trim() === '') return { ok: false, detail: 'usage_model_required' };
  if (typeof raw.route !== 'string' || !ROUTES.has(raw.route)) return { ok: false, detail: 'usage_route_invalid' };
  // The ledger key is the EVENT'S entity id, which the push validated: a client-chosen id
  // could overflow the key column or name another member's row and suppress it.
  if (raw.clientEventId !== undefined && raw.clientEventId !== clientEntityId) return { ok: false, detail: 'usage_event_id_mismatch' };
  const clientEventId = clientEntityId;
  const tokens = [raw.promptTokens, raw.completionTokens, raw.cacheReadTokens, raw.cacheCreationTokens, raw.savedPrompt, raw.savedCompletion, raw.recallPrompt, raw.savedCostMc];
  if (tokens.some((value) => count(value) > MAX_TOKENS)) return { ok: false, detail: 'usage_tokens_out_of_range' };
  const local = raw.savingsSource === 'local_model'
    ? {
        savedPrompt: count(raw.savedPrompt),
        savedCompletion: count(raw.savedCompletion),
        recallPrompt: count(raw.recallPrompt),
        // Net value in millicents; may legitimately be 0, never negative for a local call.
        savedCostMc: count(raw.savedCostMc),
      }
    : null;
  return {
    ok: true,
    value: {
      clientEventId,
      clientChatId: typeof raw.clientChatId === 'string' ? raw.clientChatId : null,
      model: raw.model.slice(0, MODEL_MAX),
      route: raw.route as UsageFields['route'],
      mode: typeof raw.mode === 'string' && MODES.has(raw.mode) ? (raw.mode as 'chat' | 'work') : null,
      role: typeof raw.role === 'string' && raw.role.length > 0 && raw.role.length <= ROLE_MAX ? raw.role : null,
      pipeline: readPipelineAttribution(raw),
      promptTokens: count(raw.promptTokens),
      completionTokens: count(raw.completionTokens),
      cacheReadTokens: count(raw.cacheReadTokens),
      cacheCreationTokens: count(raw.cacheCreationTokens),
      localSaving: local,
      at: raw.at,
    },
  };
}

/** The vendor a `direct/<vendor>/<model>` id names, as the ledger's provider id. */
function directProvider(model: string): string | null {
  if (!model.startsWith('direct/')) return null;
  const vendor = model.slice('direct/'.length).split('/')[0];
  return vendor ? normalizeByoProvider(vendor) : null;
}

/** Apply one usage import. Create/import only; the write goes to the usage ledger port. */
export async function importSyncedUsage(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  ledger: SyncUsageLedger,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== 'usage') return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  if (event.operation !== 'create' && event.operation !== 'import') return rejected('usage_immutable');
  const parsed = readUsage(event.payload, event.clientEntityId);
  if (!parsed.ok) return rejected(parsed.detail);
  const usage = parsed.value;
  if (usage.route === 'gateway') return rejected('usage_server_observed');

  const tenantId = ctx.auth.tenantId;
  const mapping = await stores.findMapping(tenantId, event.entityType, event.clientEntityId);
  if (mapping) {
    if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
    if (mapping.payloadHash === event.payloadHash) return appliedExisting(mapping, event.payload);
    return conflict(mapping, 'entity_already_imported');
  }

  const idempotencyKey = `${SYNC_USAGE_IDEMPOTENCY_PREFIX}${usage.clientEventId}`;
  // A chat that has not landed (or is not the caller's) ⇒ the row is still written,
  // unattributed: spend is never dropped, and never pinned on someone else's chat.
  const chat = await mappedChat(stores, ctx, usage.clientChatId);
  const chatId = chat.kind === 'own' ? chat.chatId : null;
  try {
    await ledger.record({
      tenantId,
      userId: ctx.auth.userId,
      llmProduct: 'builderforceLLM',
      model: usage.model,
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.promptTokens + usage.completionTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
      },
      metadata: {
        ...(chatId !== null ? { chatId } : {}),
        ...(usage.mode ? { mode: usage.mode } : {}),
        // The same metadata keys a gateway call carries, so the writer promotes them to
        // the `pipeline_route` / `route_score` columns for a device's own calls too.
        ...(usage.pipeline.pipelineRoute ? { pipelineRoute: usage.pipeline.pipelineRoute } : {}),
        ...(usage.pipeline.routeScore !== null ? { routeScore: usage.pipeline.routeScore } : {}),
        clientEventId: usage.clientEventId,
        source: 'client-reported',
      },
      idempotencyKey,
      useCase: USAGE_USE_CASE,
      byo: true,
      byoProvider: usage.route === 'byo-direct' ? directProvider(usage.model) : null,
      surface: 'vsix',
      ...(usage.role ? { attribution: { role: usage.role } } : {}),
      calls: 1,
      createdAt: clampedClientTime(usage.at, ctx.now),
      ...(usage.localSaving
        ? {
            savings: {
              source: 'local_model' as const,
              savedPromptTokens: usage.localSaving.savedPrompt,
              savedCompletionTokens: usage.localSaving.savedCompletion,
              recallPromptTokens: usage.localSaving.recallPrompt,
              estimated: true,
            },
            savedCostMillicents: usage.localSaving.savedCostMc,
          }
        : {}),
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/sync/importers/importSyncedUsage.ts', operation: 'importSyncedUsage' });
    return pending('usage_write_failed');
  }
  return appliedNew(event.clientEntityId, 1, ctx.destinationKey, event.payload);
}
