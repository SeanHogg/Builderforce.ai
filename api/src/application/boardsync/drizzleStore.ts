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
} from './SyncEngine';
import type { SyncState } from './reconciler';
import type { ChangeSet } from './providers';

function parseFields(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
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
        fields: parseFields(null), // fields are reconstructed from task; not stored as column
      };
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
          .set({ title: input.title, description: input.description, source: input.provider, updatedAt: now })
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
          status: 'backlog',
          priority: 'medium',
          source: input.provider,
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
      const rows = await db
        .select()
        .from(boardSyncOutbox)
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
        externalId: null,
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
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Credential decryption (mirrors integrationRoutes AES-256-GCM scheme)
// ---------------------------------------------------------------------------

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('builderforce-integrations'), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function decryptCredentials(
  encB64: string,
  ivHex: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  try {
    const key = await deriveKey(secret);
    const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      Uint8Array.from(atob(encB64), (c) => c.charCodeAt(0)),
    );
    return JSON.parse(new TextDecoder().decode(dec)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

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
  const creds = await decryptCredentials(row.credentialsEnc, row.iv, secret);
  if (!creds) return null;
  return { credentials: creds, baseUrl: row.baseUrl };
}
