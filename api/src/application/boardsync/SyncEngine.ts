/**
 * SyncEngine — orchestrates inbound sync and outbound drain for a board
 * connection, using the PURE reconciler for every per-ticket decision.
 *
 * The engine talks to persistence through a narrow port (BoardSyncStore) rather
 * than Drizzle directly. The route wires a real adapter over `Db`; unit tests
 * inject an in-memory fake, so the happy path is testable with zero DB calls.
 *
 * Network access is fully behind injected providers (which themselves use an
 * injected fetch), so no test ever hits the network.
 */

import {
  reconcile,
  type ExistingLink,
  type ReconcileResult,
  type SyncState,
} from './reconciler';
import type { BoardProvider, ChangeSet, NormalizedTicket } from './providers';

// ---------------------------------------------------------------------------
// Persistence port (implemented by a Drizzle adapter in the route layer)
// ---------------------------------------------------------------------------

export interface StoredConnection {
  id:           string;
  tenantId:     number;
  segmentId:    string | null;
  projectId:    number;
  provider:     string;
  pollCursor:   string | null;
}

export interface StoredLink {
  id:              string;
  connectionId:    string;
  taskId:          number | null;
  externalId:      string;
  externalVersion: string | null;
  contentHash:     string | null;
  syncState:       SyncState;
  fields:          Record<string, unknown> | null;
}

export interface UpsertLinkInput {
  connectionId:    string;
  tenantId:        number;
  segmentId:       string | null;
  provider:        string;
  externalId:      string;
  externalUrl:     string | null;
  externalVersion: string | null;
  contentHash:     string | null;
  syncState:       SyncState;
  fields:          Record<string, unknown>;
  taskId:          number | null;
}

export interface UpsertTaskInput {
  projectId:   number;
  tenantId:    number;
  segmentId:   string | null;
  externalId:  string;
  provider:    string;
  title:       string;
  description: string | null;
  /** Existing BF task id when the link already points at one. */
  existingTaskId: number | null;
}

export interface OutboxRow {
  id:           string;
  connectionId: string;
  externalId:   string | null;
  taskId:       number | null;
  changeSet:    ChangeSet;
  attempts:     number;
}

/** Narrow persistence port. Each method is one logical DB operation. */
export interface BoardSyncStore {
  getConnection(connectionId: string): Promise<StoredConnection | null>;
  getLink(connectionId: string, externalId: string): Promise<StoredLink | null>;
  upsertLink(input: UpsertLinkInput): Promise<StoredLink>;
  /** Create or update the BF task; returns its id. */
  upsertTask(input: UpsertTaskInput): Promise<number>;
  setLinkTask(linkId: string, taskId: number): Promise<void>;
  advanceCursor(connectionId: string, cursor: string | null): Promise<void>;
  writeSyncLog(input: {
    connectionId: string;
    tenantId: number;
    status: 'success' | 'error';
    itemsProcessed: number;
    itemsErrored: number;
    errorMessage: string | null;
    cursorAfter: string | null;
    durationMs: number;
  }): Promise<void>;
  // Outbox
  listPendingOutbox(connectionId: string, now: Date, limit: number): Promise<OutboxRow[]>;
  markOutboxDone(id: string): Promise<void>;
  markOutboxRetry(id: string, attempts: number, nextAttemptAt: Date, lastError: string): Promise<void>;
  markOutboxDead(id: string, lastError: string): Promise<void>;
}

export interface SyncConnectionResult {
  connectionId: string;
  processed: number;
  applied: number;
  skipped: number;
  conflicts: number;
  errored: number;
  cursorAfter: string | null;
}

export interface DrainResult {
  connectionId: string;
  drained: number;
  succeeded: number;
  retried: number;
  dead: number;
}

const MAX_OUTBOX_ATTEMPTS = 6;

/** Exponential backoff (capped) for outbox retries. Pure helper, exported for tests. */
export function computeBackoffMs(attempts: number): number {
  const base = 1000; // 1s
  const capped = Math.min(Math.max(attempts, 0), 20); // guard against huge exponents
  return Math.min(base * 2 ** capped, 60 * 60 * 1000); // cap at 1h
}

export class SyncEngine {
  constructor(
    private readonly store: BoardSyncStore,
    /** Factory that builds a provider for a connection (injectable for tests). */
    private readonly providerFor: (conn: StoredConnection) => BoardProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Inbound sync: pull tickets since the stored cursor, reconcile each, upsert
   * the link + BF task, advance the cursor, and write a sync log.
   */
  async syncConnection(connectionId: string): Promise<SyncConnectionResult> {
    const start = this.now().getTime();
    const conn = await this.store.getConnection(connectionId);
    if (!conn) throw new Error(`connection not found: ${connectionId}`);

    const provider = this.providerFor(conn);
    const result: SyncConnectionResult = {
      connectionId,
      processed: 0,
      applied: 0,
      skipped: 0,
      conflicts: 0,
      errored: 0,
      cursorAfter: conn.pollCursor,
    };

    try {
      const page = await provider.fetchTicketsSince(conn.pollCursor);

      for (const ticket of page.tickets) {
        result.processed += 1;
        try {
          await this.applyInboundTicket(conn, ticket);
          // tally is updated inside applyInboundTicket via the returned decision
          const decision = this.lastDecision;
          if (decision === 'applied') result.applied += 1;
          else if (decision === 'conflict') result.conflicts += 1;
          else result.skipped += 1;
        } catch {
          result.errored += 1;
        }
      }

      result.cursorAfter = page.nextCursor;
      await this.store.advanceCursor(connectionId, page.nextCursor);

      await this.store.writeSyncLog({
        connectionId,
        tenantId: conn.tenantId,
        status: result.errored > 0 ? 'error' : 'success',
        itemsProcessed: result.processed,
        itemsErrored: result.errored,
        errorMessage: null,
        cursorAfter: page.nextCursor,
        durationMs: this.now().getTime() - start,
      });

      return result;
    } catch (err) {
      await this.store.writeSyncLog({
        connectionId,
        tenantId: conn.tenantId,
        status: 'error',
        itemsProcessed: result.processed,
        itemsErrored: result.errored,
        errorMessage: err instanceof Error ? err.message : String(err),
        cursorAfter: conn.pollCursor,
        durationMs: this.now().getTime() - start,
      });
      throw err;
    }
  }

  /** Decision from the most recent applyInboundTicket (private tally channel). */
  private lastDecision: ReconcileResult['decision'] = 'skipped_idempotent';

  /** Reconcile + persist one inbound ticket. Also exposed for the webhook path. */
  async applyInboundTicket(
    conn: StoredConnection,
    ticket: NormalizedTicket,
    originatedLocally = false,
  ): Promise<ReconcileResult> {
    const existing = await this.store.getLink(conn.id, ticket.externalId);
    const existingLink: ExistingLink | null = existing
      ? {
          externalId: existing.externalId,
          externalVersion: existing.externalVersion,
          contentHash: existing.contentHash,
          syncState: existing.syncState,
          fields: existing.fields,
        }
      : null;

    const decision = reconcile(existingLink, {
      externalId: ticket.externalId,
      externalVersion: ticket.externalVersion,
      contentHash: ticket.contentHash,
      fields: ticket.fields,
      originatedLocally,
    });

    this.lastDecision = decision.decision;

    if (decision.decision === 'skipped_idempotent') {
      // Persist any state clear (e.g. echo → synced) without re-creating the task.
      if (existing && existing.syncState !== decision.merged.syncState) {
        await this.store.upsertLink({
          connectionId: conn.id,
          tenantId: conn.tenantId,
          segmentId: conn.segmentId,
          provider: conn.provider,
          externalId: decision.merged.externalId,
          externalUrl: ticket.externalUrl,
          externalVersion: decision.merged.externalVersion,
          contentHash: decision.merged.contentHash,
          syncState: decision.merged.syncState,
          fields: decision.merged.fields,
          taskId: existing.taskId,
        });
      }
      return decision;
    }

    // applied OR conflict → upsert the link, and (for applied) the BF task.
    let taskId = existing?.taskId ?? null;
    if (decision.decision === 'applied') {
      taskId = await this.store.upsertTask({
        projectId: conn.projectId,
        tenantId: conn.tenantId,
        segmentId: conn.segmentId,
        externalId: ticket.externalId,
        provider: conn.provider,
        title: ticket.title,
        description: ticket.body,
        existingTaskId: existing?.taskId ?? null,
      });
    }

    const link = await this.store.upsertLink({
      connectionId: conn.id,
      tenantId: conn.tenantId,
      segmentId: conn.segmentId,
      provider: conn.provider,
      externalId: decision.merged.externalId,
      externalUrl: ticket.externalUrl,
      externalVersion: decision.merged.externalVersion,
      contentHash: decision.merged.contentHash,
      syncState: decision.merged.syncState,
      fields: decision.merged.fields,
      taskId,
    });

    if (taskId != null && link.taskId !== taskId) {
      await this.store.setLinkTask(link.id, taskId);
    }

    return decision;
  }

  /**
   * Outbound drain: push pending outbox rows via provider.pushUpdate with
   * attempts/backoff. Rows that exceed MAX_OUTBOX_ATTEMPTS become 'dead'.
   */
  async drainOutbox(connectionId: string, limit = 50): Promise<DrainResult> {
    const conn = await this.store.getConnection(connectionId);
    if (!conn) throw new Error(`connection not found: ${connectionId}`);
    const provider = this.providerFor(conn);

    const rows = await this.store.listPendingOutbox(connectionId, this.now(), limit);
    const result: DrainResult = { connectionId, drained: 0, succeeded: 0, retried: 0, dead: 0 };

    for (const row of rows) {
      result.drained += 1;
      if (!row.externalId) {
        await this.store.markOutboxDead(row.id, 'missing externalId');
        result.dead += 1;
        continue;
      }
      try {
        await provider.pushUpdate(row.externalId, row.changeSet);
        await this.store.markOutboxDone(row.id);
        result.succeeded += 1;
      } catch (err) {
        const attempts = row.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        if (attempts >= MAX_OUTBOX_ATTEMPTS) {
          await this.store.markOutboxDead(row.id, message);
          result.dead += 1;
        } else {
          const next = new Date(this.now().getTime() + computeBackoffMs(attempts));
          await this.store.markOutboxRetry(row.id, attempts, next, message);
          result.retried += 1;
        }
      }
    }

    return result;
  }
}
