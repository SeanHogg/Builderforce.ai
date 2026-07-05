/**
 * ITSM-event ingest — route `itsm`-category connector poll results (Freshservice,
 * ServiceNow) into support_tickets (the Quality lens / board Support metrics)
 * instead of the task board. A support ticket is NOT a kanban card, so it must not
 * reconcile into tasks; this is the poll-path twin of opsIngest's incident-webhook
 * diversion. Upsert is keyed by (tenant, source, external_ref) to match the
 * migration's unique index, so a re-polled ticket updates in place.
 *
 * Reuses the board-sync store for cursor advance + sync-log so an ITSM connection
 * behaves like any other synced connection (cursor, last_polled_at, sync history),
 * minus the task reconcile.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { supportTickets } from '../../infrastructure/database/schema';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { qualityVersionKey } from '../insights/versionKeys';
import type { BoardProvider, NormalizedTicket } from './providers';
import type { BoardSyncStore } from './SyncEngine';

const CLOSED_STATES = new Set(['resolved', 'closed', 'done', 'completed', 'fixed']);

/** A connection as the ITSM sync needs it (subset of board_connections). */
export interface ItsmConnection {
  id: string;
  tenantId: number;
  segmentId: string | null;
  provider: string;
  pollCursor: string | null;
}

export interface ItsmSupportRow {
  tenantId: number;
  segmentId: string | null;
  source: string;
  externalRef: string;
  subject: string;
  category: string;
  isBug: boolean;
  priority: string;
  status: string;
  customerRef: string | null;
  resolvedAt: Date | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * Pure: map a normalized ITSM ticket onto a support_tickets row. `now` stamps the
 * resolved time for tickets that have reached a terminal state. Exposed for tests.
 */
export function mapTicketToSupportRow(conn: ItsmConnection, ticket: NormalizedTicket, now: Date): ItsmSupportRow {
  const f = ticket.fields ?? {};
  const ticketType = (str(f.ticketType) ?? str(f.category) ?? '').toLowerCase();
  const isBug = /incident|problem|bug|defect|outage/.test(ticketType) || (conn.provider === 'servicenow' && /incident/.test((str(f.number) ?? '').toLowerCase()));
  const state = (ticket.state || 'open').toLowerCase();
  return {
    tenantId: conn.tenantId,
    segmentId: conn.segmentId,
    source: ticket.source,
    externalRef: ticket.externalId,
    subject: (ticket.title || `${ticket.source} ${ticket.externalId}`).slice(0, 512),
    category: isBug ? 'bug' : 'other',
    isBug,
    priority: str(f.priority) ?? 'normal',
    status: state.slice(0, 16),
    customerRef: str(f.requester),
    resolvedAt: CLOSED_STATES.has(state) ? now : null,
  };
}

/**
 * Poll an ITSM connection and upsert its tickets into support_tickets, advancing
 * the cursor + writing a sync log via the shared store. Bumps the Quality lens
 * cache so the board Support metrics refresh. Returns the processed count.
 */
export async function syncItsmConnection(
  db: Db,
  env: Env,
  conn: ItsmConnection,
  provider: BoardProvider,
  store: BoardSyncStore,
): Promise<{ processed: number; cursorAfter: string | null }> {
  const start = Date.now();
  try {
    const page = await provider.fetchTicketsSince(conn.pollCursor);
    const now = new Date();

    // One batched upsert for the whole page instead of an INSERT round-trip per
    // ticket (neon-http has no interactive tx — db.batch pipelines the statements).
    const upserts = page.tickets.map((ticket) => {
      const row = mapTicketToSupportRow(conn, ticket, now);
      return db.insert(supportTickets)
        .values({ ...row, openedAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [supportTickets.tenantId, supportTickets.source, supportTickets.externalRef],
          set: {
            subject: row.subject, category: row.category, isBug: row.isBug, priority: row.priority,
            status: row.status, customerRef: row.customerRef, resolvedAt: row.resolvedAt, updatedAt: now,
          },
        });
    });
    if (upserts.length > 0) {
      await db.batch(upserts as unknown as Parameters<typeof db.batch>[0]);
    }

    await store.advanceCursor(conn.id, page.nextCursor);
    await store.writeSyncLog({
      connectionId: conn.id,
      tenantId: conn.tenantId,
      status: 'success',
      itemsProcessed: page.tickets.length,
      itemsErrored: 0,
      errorMessage: null,
      cursorAfter: page.nextCursor,
      durationMs: Date.now() - start,
    });
    if (page.tickets.length > 0) await bumpCacheVersion(env, qualityVersionKey(conn.tenantId));

    return { processed: page.tickets.length, cursorAfter: page.nextCursor };
  } catch (err) {
    await store.writeSyncLog({
      connectionId: conn.id,
      tenantId: conn.tenantId,
      status: 'error',
      itemsProcessed: 0,
      itemsErrored: 1,
      errorMessage: err instanceof Error ? err.message : String(err),
      cursorAfter: conn.pollCursor,
      durationMs: Date.now() - start,
    });
    throw err;
  }
}

/** True when a provider id is an ITSM connector that feeds support_tickets. */
export function isItsmProvider(provider: string): boolean {
  return provider === 'freshservice' || provider === 'servicenow';
}
