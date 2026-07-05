/**
 * Drizzle-backed implementation of BoardSyncStore + credential decryption.
 *
 * Lives in the application layer (no Hono/route coupling) so the SyncEngine can
 * be wired in both the route handler and any future scheduled() runner. All
 * queries are scoped by tenantId where the table carries it.
 */

import { and, eq, lte } from 'drizzle-orm';
import {
  boardConnections,
  externalTicketLinks,
  boardSyncOutbox,
  boardTypeMappings,
  integrationSyncLogs,
  integrationCredentials,
  tasks,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type {
  BoardSyncStore,
  StoredConnection,
  StoredLink,
  UpsertLinkInput,
  UpsertTaskInput,
  OutboxRow,
  TypeMapping,
} from './SyncEngine';
import type { SyncState } from './reconciler';
import type { ChangeSet } from './providers';
import { parseJsonObject } from '../../domain/shared/json';

/**
 * Coerce a stored `fields` jsonb value back into a plain object. The driver may
 * hand back an already-parsed object (neon-http) or a JSON string; both resolve
 * to the same bag. Non-object/empty values become null.
 */
function normalizeFields(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

export function createDrizzleStore(db: Db): BoardSyncStore {
  return {
    async getConnection(connectionId: string): Promise<StoredConnection | null> {
      const [row] = await db
        .select({
          id: boardConnections.id,
          tenantId: boardConnections.tenantId,
          segmentId: boardConnections.segmentId,
          projectId: boardConnections.projectId,
          provider: boardConnections.provider,
          pollCursor: boardConnections.pollCursor,
        })
        .from(boardConnections)
        .where(eq(boardConnections.id, connectionId))
        .limit(1);
      return row ?? null;
    },

    async getLink(connectionId: string, externalId: string): Promise<StoredLink | null> {
      const [row] = await db
        .select()
        .from(externalTicketLinks)
        .where(
          and(
            eq(externalTicketLinks.connectionId, connectionId),
            eq(externalTicketLinks.externalId, externalId),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        connectionId: row.connectionId,
        taskId: row.taskId,
        externalId: row.externalId,
        externalVersion: row.externalVersion,
        contentHash: row.contentHash,
        syncState: row.syncState as SyncState,
        fields: normalizeFields(row.fields),
      };
    },

    async listTypeMappings(connectionId: string): Promise<TypeMapping[]> {
      const rows = await db
        .select({
          externalType: boardTypeMappings.externalType,
          targetTaskType: boardTypeMappings.targetTaskType,
          targetStatus: boardTypeMappings.targetStatus,
        })
        .from(boardTypeMappings)
        .where(eq(boardTypeMappings.connectionId, connectionId));
      return rows.map((r) => ({ externalType: r.externalType, targetTaskType: r.targetTaskType, targetStatus: r.targetStatus ?? null }));
    },

    async upsertLink(input: UpsertLinkInput): Promise<StoredLink> {
      const now = new Date();
      const [row] = await db
        .insert(externalTicketLinks)
        .values({
          tenantId: input.tenantId,
          segmentId: input.segmentId,
          connectionId: input.connectionId,
          taskId: input.taskId,
          provider: input.provider,
          externalId: input.externalId,
          externalUrl: input.externalUrl,
          externalVersion: input.externalVersion,
          contentHash: input.contentHash,
          fields: input.fields,
          syncState: input.syncState,
          lastInboundAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [externalTicketLinks.connectionId, externalTicketLinks.externalId],
          set: {
            taskId: input.taskId,
            externalUrl: input.externalUrl,
            externalVersion: input.externalVersion,
            contentHash: input.contentHash,
            fields: input.fields,
            syncState: input.syncState,
            lastInboundAt: now,
            updatedAt: now,
          },
        })
        .returning();
      if (!row) throw new Error('upsertLink returned no row');
      return {
        id: row.id,
        connectionId: row.connectionId,
        taskId: row.taskId,
        externalId: row.externalId,
        externalVersion: row.externalVersion,
        contentHash: row.contentHash,
        syncState: row.syncState as SyncState,
        fields: input.fields,
      };
    },

    async upsertTask(input: UpsertTaskInput): Promise<number> {
      const now = new Date();
      if (input.existingTaskId != null) {
        await db
          .update(tasks)
          .set({
            title: input.title, description: input.description, source: input.provider, updatedAt: now,
            // Only write the estimate when the provider supplied one — never clobber
            // a manual estimate with null (EMP-4).
            ...(input.storyPoints != null ? { storyPoints: input.storyPoints } : {}),
          })
          .where(eq(tasks.id, input.existingTaskId));
        return input.existingTaskId;
      }
      const key = `${input.provider.toUpperCase()}-${input.externalId}`.slice(0, 100);
      const [row] = await db
        .insert(tasks)
        .values({
          projectId: input.projectId,
          segmentId: input.segmentId ?? undefined,
          key,
          title: input.title,
          description: input.description,
          // Type/status from the persistent board_type_mapping (migration 0256) when
          // present; otherwise the original backlog/task defaults.
          status: input.status ?? 'backlog',
          priority: 'medium',
          taskType: (input.taskType === 'epic' ? 'epic' : 'task'),
          source: input.provider,
          storyPoints: input.storyPoints ?? undefined,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: tasks.id });
      if (!row) throw new Error('upsertTask returned no row');
      return row.id;
    },

    async setLinkTask(linkId: string, taskId: number): Promise<void> {
      await db
        .update(externalTicketLinks)
        .set({ taskId, updatedAt: new Date() })
        .where(eq(externalTicketLinks.id, linkId));
    },

    async advanceCursor(connectionId: string, cursor: string | null): Promise<void> {
      await db
        .update(boardConnections)
        .set({ pollCursor: cursor, lastPolledAt: new Date(), updatedAt: new Date() })
        .where(eq(boardConnections.id, connectionId));
    },

    async writeSyncLog(input): Promise<void> {
      // board_connections has no credentialId guarantee; sync logs are keyed by
      // credentialId. Resolve the connection's credentialId (best-effort).
      const [conn] = await db
        .select({ credentialId: boardConnections.credentialId, tenantId: boardConnections.tenantId, segmentId: boardConnections.segmentId })
        .from(boardConnections)
        .where(eq(boardConnections.id, input.connectionId))
        .limit(1);
      if (!conn?.credentialId) return; // no credential → skip log (table requires credentialId)
      await db.insert(integrationSyncLogs).values({
        tenantId: input.tenantId,
        segmentId: conn.segmentId,
        credentialId: conn.credentialId,
        status: input.status === 'success' ? 'success' : 'error',
        itemsProcessed: input.itemsProcessed,
        itemsErrored: input.itemsErrored,
        errorMessage: input.errorMessage,
        durationMs: input.durationMs,
        cursorAfter: input.cursorAfter,
        startedAt: new Date(Date.now() - input.durationMs),
        completedAt: new Date(),
      });
    },

    async listPendingOutbox(connectionId: string, now: Date, limit: number): Promise<OutboxRow[]> {
      // Resolve each row's target externalId from its link (connection+task) in one
      // join — drainOutbox needs it to address the provider, and a missing link
      // makes the drain dead-letter the row (rather than guessing).
      const rows = await db
        .select({
          id: boardSyncOutbox.id,
          connectionId: boardSyncOutbox.connectionId,
          taskId: boardSyncOutbox.taskId,
          changeSet: boardSyncOutbox.changeSet,
          attempts: boardSyncOutbox.attempts,
          externalId: externalTicketLinks.externalId,
        })
        .from(boardSyncOutbox)
        .leftJoin(
          externalTicketLinks,
          and(
            eq(externalTicketLinks.connectionId, boardSyncOutbox.connectionId),
            eq(externalTicketLinks.taskId, boardSyncOutbox.taskId),
          ),
        )
        .where(
          and(
            eq(boardSyncOutbox.connectionId, connectionId),
            eq(boardSyncOutbox.status, 'pending'),
            lte(boardSyncOutbox.nextAttemptAt, now),
          ),
        )
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        connectionId: r.connectionId,
        externalId: r.externalId ?? null,
        taskId: r.taskId,
        changeSet: (r.changeSet ? safeParse(r.changeSet) : {}) as ChangeSet,
        attempts: r.attempts,
      }));
    },

    async markOutboxDone(id: string): Promise<void> {
      await db.update(boardSyncOutbox).set({ status: 'done' }).where(eq(boardSyncOutbox.id, id));
    },

    async markOutboxRetry(id: string, attempts: number, nextAttemptAt: Date, lastError: string): Promise<void> {
      await db
        .update(boardSyncOutbox)
        .set({ status: 'pending', attempts, nextAttemptAt, lastError })
        .where(eq(boardSyncOutbox.id, id));
    },

    async markOutboxDead(id: string, lastError: string): Promise<void> {
      await db.update(boardSyncOutbox).set({ status: 'dead', lastError }).where(eq(boardSyncOutbox.id, id));
    },
  };
}

function safeParse(raw: string): Record<string, unknown> {
  return parseJsonObject(raw);
}

// ---------------------------------------------------------------------------
// Credential decryption — delegates to the canonical per-tenant AES-256-GCM
// helper so boardsync/repo consumers honor the SAME versioned key scheme the
// integrations CRUD writes (v2 per-tenant, with legacy v1 global-key fallback).
// Re-exported here for the existing import paths; pass the owning tenantId so a
// v2 row decrypts (a legacy v1 row decrypts with or without it).
// ---------------------------------------------------------------------------

export { decryptCredentials } from '../integrations/credentialCrypto';
import { decryptCredentials } from '../integrations/credentialCrypto';

/** Load + decrypt a board connection's provider credentials. Tenant-scoped. */
export async function loadConnectionCredentials(
  db: Db,
  tenantId: number,
  credentialId: string | null,
  secret: string,
): Promise<{ credentials: Record<string, unknown>; baseUrl: string | null } | null> {
  if (!credentialId) return { credentials: {}, baseUrl: null };
  const [row] = await db
    .select()
    .from(integrationCredentials)
    .where(and(eq(integrationCredentials.id, credentialId), eq(integrationCredentials.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;
  const creds = await decryptCredentials(row.credentialsEnc, row.iv, secret, tenantId);
  if (!creds) return null;
  return { credentials: creds, baseUrl: row.baseUrl };
}
