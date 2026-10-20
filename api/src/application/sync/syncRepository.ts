/**
 * Application — server push ingest repository (G15, ticket #5849).
 *
 * One push batch, three ordered stages, no persistence of its own:
 *
 * 1. Every event is gated with `rejectInvalidOccurredAt` against the INJECTED
 *    server clock BEFORE the first apply. A non-null code skips
 *    `applySyncEvent` for that event entirely — no projection, no receipt, no
 *    change-log row. `null`, including an arbitrarily old historical import,
 *    falls through.
 * 2. `planBatchIngest` decides the order from the batch's `dependsOn` edges. A
 *    cycle, a duplicate event id, or a dependency that is not in this batch
 *    applies NOTHING: the whole batch is refused before any write.
 * 3. The planned order is applied through the existing idempotent
 *    `applySyncEvent`, which owns at-most-once semantics and commits the
 *    projection, the receipt and the change-log row in one transaction.
 *
 * The clock gate is a pass of its own so "before any apply" is true for the
 * BATCH, not merely per event: a refused event is never applied, and it is
 * never used to justify applying a later one.
 *
 * A `dependsOn` id that is not an event in this batch is a missing dependency
 * and refuses the batch here. That is deliberately stricter than
 * `applySyncEvent`, which answers `dependency_pending` for an id not yet
 * accepted in the tenant, so an id from an earlier batch cannot ride in on a
 * later batch through this entry point.
 *
 * The store is injected (`IdempotentApplyStore`), so a Postgres implementation
 * can satisfy the port without changing the order of the checks. This module
 * inserts no row itself, opens no database and calls no network function, and
 * it registers no route: `POST /api/sync/v1/push` is still UNMOUNTED, so this
 * file alone does not close ticket #5849.
 */

import { planBatchIngest, type BatchIngestItem } from './batchIngestPlan';
import {
  applySyncEvent,
  type IdempotentApplyStore,
  type SyncApplyEvent,
  type SyncApplyResult,
} from './idempotentApply';
import { rejectInvalidOccurredAt } from './occurredAtGate';
import type { OccurredAtErrorCode } from '../../domain/sync/syncProtocol';

/** One pushed event, as far as this repository is concerned. */
export interface AcceptPushEvent {
  eventId: string;
  clientEntityId: string;
  entityType: string;
  /** Client time. Omitted, null, or blank is no claim and is not gated. */
  occurredAt?: string | null;
  dependsOn?: readonly string[] | null;
  payload?: unknown;
}

export interface AcceptPushInput {
  tenantId: number;
  deviceId: string;
  events: readonly AcceptPushEvent[];
  /** The server clock. `now` is an argument; no clock is read in this module. */
  now: Date;
  store: IdempotentApplyStore;
}

/** Per-event outcome. `rejected` is a clock refusal: `applySyncEvent` was not called. */
export interface AcceptPushReceipt {
  eventId: string;
  status: 'accepted' | 'duplicate' | 'dependency_pending' | 'rejected';
  serverId: string | null;
  /** The `occurredAt` refusal code, the unusable event id, or the first unmet dependency. */
  detail?: string;
}

/** A batch that ordered and ran. */
export interface AcceptPushApplied {
  ok: true;
  /** One receipt per event, in INPUT order, so a client can map by eventId. */
  receipts: AcceptPushReceipt[];
  /** Event ids in the order they were handed to `applySyncEvent`. */
  appliedOrder: string[];
  /** Event ids the clock gate refused; none of them was applied. */
  gatedOut: string[];
}

/** A batch that applied nothing at all. */
export interface AcceptPushRefused {
  ok: false;
  reason: 'invalid_batch' | 'cycle' | 'duplicate_client_ref' | 'missing_dependency';
  clientRef?: string;
  missing?: string;
  /** Always empty: the refusal is proven before the first apply. */
  receipts: readonly AcceptPushReceipt[];
  appliedOrder: readonly string[];
}

export type AcceptPushResult = AcceptPushApplied | AcceptPushRefused;

const EMPTY: readonly AcceptPushReceipt[] = Object.freeze([]);
const NO_APPLIED: readonly string[] = Object.freeze([]);

function usableId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Dependency ids this batch can actually order. Non-strings and blanks are
 * dropped. A SELF-reference is kept so `planBatchIngest` still sees it as a
 * cycle — silently dropping it would turn a client defect into a valid batch.
 */
function orderableDependencies(event: AcceptPushEvent): string[] {
  const declared = event.dependsOn;
  if (!Array.isArray(declared)) return [];
  const ids: string[] = [];
  for (const candidate of declared) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed !== '') ids.push(trimmed);
  }
  return ids;
}

/** The client time this event claims, or undefined when it makes no claim. */
function claimedOccurredAt(event: AcceptPushEvent): string | undefined {
  const value = event.occurredAt;
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function refused(result: Omit<AcceptPushRefused, 'receipts' | 'appliedOrder'>): AcceptPushRefused {
  return { ...result, receipts: EMPTY, appliedOrder: NO_APPLIED };
}

function toApplyEvent(input: AcceptPushInput, event: AcceptPushEvent): SyncApplyEvent {
  return {
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    eventId: event.eventId,
    clientEntityId: event.clientEntityId,
    entityType: event.entityType,
    payload: event.payload,
    dependsOn: orderableDependencies(event),
  };
}

function toReceipt(eventId: string, result: SyncApplyResult): AcceptPushReceipt {
  const receipt: AcceptPushReceipt = { eventId, status: result.status, serverId: result.serverId };
  if (result.status === 'dependency_pending' && result.unmet !== undefined) receipt.detail = result.unmet;
  return receipt;
}

/**
 * Accept one push batch.
 *
 * - The `occurredAt` gate runs over EVERY event before the first apply. An
 *   event refused by the gate is skipped — `applySyncEvent` is never called for
 *   it, and it contributes no receipt row and no change-log row.
 * - Order comes from `planBatchIngest`. A cycle, a repeated event id, or a
 *   dependency that is not in this batch applies nothing at all.
 * - The surviving events are applied in the planned order through
 *   `applySyncEvent`, which answers `duplicate` for a replay and
 *   `dependency_pending` for an id it has not accepted.
 *
 * Receipts are returned in input order; `appliedOrder` is the order the plan
 * chose. The input array is never mutated.
 */
export function acceptPush(input: AcceptPushInput): AcceptPushResult {
  if (!Array.isArray(input.events)) return refused({ ok: false, reason: 'invalid_batch' });
  const events = input.events;

  // An event with no usable id cannot be ordered or receipted. It is refused on
  // its own rather than being allowed to derail the batch.
  const planItems: BatchIngestItem[] = [];
  const orderable = new Map<string, AcceptPushEvent>();
  for (const event of events) {
    if (!usableId(event.eventId)) continue;
    planItems.push({
      clientRef: event.eventId,
      entityType: event.entityType,
      operation: 'apply',
      dependsOn: orderableDependencies(event),
    });
    // The FIRST occurrence is the one that is planned; `planBatchIngest` refuses
    // the whole batch when the id appears twice, so a later copy is never used.
    if (!orderable.has(event.eventId)) orderable.set(event.eventId, event);
  }

  // Stage 2 decides order. Nothing below this line runs when it refuses.
  const planned = planBatchIngest(planItems);
  if (!planned.ok) {
    if (planned.reason === 'duplicate_client_ref') {
      return refused({ ok: false, reason: 'duplicate_client_ref', clientRef: planned.clientRef });
    }
    if (planned.reason === 'missing_dependency') {
      return refused({
        ok: false,
        reason: 'missing_dependency',
        clientRef: planned.clientRef,
        missing: planned.missing,
      });
    }
    return refused({ ok: false, reason: 'cycle' });
  }

  // Stage 1: gate EVERY event against the injected clock, before the first apply.
  const gated = new Map<string, OccurredAtErrorCode>();
  for (const event of orderable.values()) {
    const occurredAt = claimedOccurredAt(event);
    if (occurredAt === undefined) continue;
    const code = rejectInvalidOccurredAt(occurredAt, input.now);
    if (code !== null) gated.set(event.eventId, code);
  }

  const gatedOut: string[] = [];
  const appliedOrder: string[] = [];
  const outcome = new Map<string, AcceptPushReceipt>();
  for (const item of planned.items) {
    const event = orderable.get(item.clientRef);
    if (event === undefined) continue;
    const code = gated.get(event.eventId);
    if (code !== undefined) {
      gatedOut.push(event.eventId);
      outcome.set(event.eventId, {
        eventId: event.eventId,
        status: 'rejected',
        serverId: null,
        detail: code,
      });
      continue;
    }
    outcome.set(event.eventId, toReceipt(event.eventId, applySyncEvent(input.store, toApplyEvent(input, event))));
    appliedOrder.push(event.eventId);
  }

  // Receipts follow the input order the client sent, not the planned order.
  const receipts: AcceptPushReceipt[] = [];
  for (const event of events) {
    const known = usableId(event.eventId) ? outcome.get(event.eventId) : undefined;
    receipts.push(
      known ?? {
        eventId: typeof event.eventId === 'string' ? event.eventId : '',
        status: 'rejected',
        serverId: null,
        detail: 'event_id_invalid',
      },
    );
  }

  return { ok: true, receipts, appliedOrder, gatedOut };
}