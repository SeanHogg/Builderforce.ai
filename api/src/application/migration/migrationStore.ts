/**
 * Drizzle-backed implementation of MigrationStore.
 *
 * Lives in the application layer (no Hono/route coupling) so MigrationService can
 * be wired by the route handler. All queries are tenant-scoped where the table
 * carries a tenant_id; run-scoped child tables inherit isolation via their run.
 *
 * Tasks are inserted directly here (not via TaskService) — exactly as the
 * boardsync drizzleStore does — to avoid firing the per-task agent-assignment /
 * Epic-decomposition hooks on a bulk import.
 */

import { and, eq, desc } from 'drizzle-orm';
import {
  importRuns,
  importStagedProjects,
  importStagedItems,
  importTypeMappings,
  importStagedUsers,
  projects,
  tasks,
  boardConnections,
  boardTypeMappings,
  externalTicketLinks,
  tenantMembers,
  tenantInvitations,
  users,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type {
  MigrationStore,
  RunRow,
  StagedProjectRow,
  StagedItemRow,
  TypeMappingRow,
  StagedUserRow,
  ImportMode,
  ImportRunStatus,
  StagedProjectAction,
  StagedUserAction,
} from './MigrationService';

function toRun(row: typeof importRuns.$inferSelect): RunRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    segmentId: row.segmentId ?? null,
    provider: row.provider,
    credentialId: row.credentialId ?? null,
    mode: row.mode as ImportMode,
    status: row.status as ImportRunStatus,
    summary: (row.summary as Record<string, number> | null) ?? null,
    errorMessage: row.errorMessage ?? null,
    createdBy: row.createdBy ?? null,
  };
}

export function createMigrationStore(db: Db): MigrationStore {
  return {
    async createRun(input): Promise<RunRow> {
      const [row] = await db.insert(importRuns).values({
        tenantId: input.tenantId,
        segmentId: input.segmentId,
        provider: input.provider,
        credentialId: input.credentialId,
        mode: input.mode,
        status: 'discovering',
        createdBy: input.createdBy,
      }).returning();
      if (!row) throw new Error('createRun returned no row');
      return toRun(row);
    },

    async getRun(runId, tenantId): Promise<RunRow | null> {
      const [row] = await db.select().from(importRuns)
        .where(and(eq(importRuns.id, runId), eq(importRuns.tenantId, tenantId))).limit(1);
      return row ? toRun(row) : null;
    },

    async listRuns(tenantId): Promise<RunRow[]> {
      const rows = await db.select().from(importRuns)
        .where(eq(importRuns.tenantId, tenantId))
        .orderBy(desc(importRuns.createdAt)).limit(100);
      return rows.map(toRun);
    },

    async updateRun(runId, patch): Promise<void> {
      await db.update(importRuns).set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        updatedAt: new Date(),
      }).where(eq(importRuns.id, runId));
    },

    async deleteRun(runId, tenantId): Promise<void> {
      await db.delete(importRuns).where(and(eq(importRuns.id, runId), eq(importRuns.tenantId, tenantId)));
    },

    async replaceStagedProjects(runId, tenantId, rows): Promise<void> {
      await db.delete(importStagedProjects).where(eq(importStagedProjects.runId, runId));
      if (!rows.length) return;
      await db.insert(importStagedProjects).values(rows.map((r) => ({
        runId, tenantId,
        externalId: r.externalId, externalKey: r.externalKey, name: r.name, description: r.description,
        externalUrl: r.externalUrl, itemCount: r.itemCount, action: r.action,
        targetProjectId: r.targetProjectId, targetProjectName: r.targetProjectName,
      })));
    },

    async replaceTypeMappings(runId, tenantId, rows): Promise<void> {
      await db.delete(importTypeMappings).where(eq(importTypeMappings.runId, runId));
      if (!rows.length) return;
      await db.insert(importTypeMappings).values(rows.map((r) => ({
        runId, tenantId, externalType: r.externalType, targetTaskType: r.targetTaskType, targetStatus: r.targetStatus,
      })));
    },

    async replaceStagedUsers(runId, tenantId, rows): Promise<void> {
      await db.delete(importStagedUsers).where(eq(importStagedUsers.runId, runId));
      if (!rows.length) return;
      await db.insert(importStagedUsers).values(rows.map((r) => ({
        runId, tenantId, externalId: r.externalId, displayName: r.displayName, email: r.email,
        action: r.action, targetUserId: r.targetUserId,
      })));
    },

    async replaceStagedItems(runId, tenantId, rows): Promise<void> {
      await db.delete(importStagedItems).where(eq(importStagedItems.runId, runId));
      // Chunk inserts so a large board doesn't exceed bind-parameter limits.
      const CHUNK = 200;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        await db.insert(importStagedItems).values(slice.map((r) => ({
          runId, tenantId, stagedProjectId: r.stagedProjectId, externalId: r.externalId,
          externalType: r.externalType, externalUrl: r.externalUrl, title: r.title, body: r.body,
          state: r.state, storyPoints: r.storyPoints, targetTaskType: r.targetTaskType,
          targetStatus: r.targetStatus, include: r.include,
        })));
      }
    },

    async listStagedProjects(runId): Promise<StagedProjectRow[]> {
      const rows = await db.select().from(importStagedProjects).where(eq(importStagedProjects.runId, runId));
      return rows.map((r) => ({
        id: r.id, runId: r.runId, externalId: r.externalId, externalKey: r.externalKey ?? null,
        name: r.name, description: r.description ?? null, externalUrl: r.externalUrl ?? null,
        itemCount: r.itemCount ?? null, action: r.action as StagedProjectAction,
        targetProjectId: r.targetProjectId ?? null, targetProjectName: r.targetProjectName ?? null,
      }));
    },

    async listStagedItems(runId): Promise<StagedItemRow[]> {
      const rows = await db.select().from(importStagedItems).where(eq(importStagedItems.runId, runId));
      return rows.map((r) => ({
        id: r.id, runId: r.runId, stagedProjectId: r.stagedProjectId, externalId: r.externalId,
        externalType: r.externalType ?? null, externalUrl: r.externalUrl ?? null, title: r.title,
        body: r.body ?? null, state: r.state ?? null, storyPoints: r.storyPoints ?? null,
        targetTaskType: r.targetTaskType, targetStatus: r.targetStatus, include: r.include,
      }));
    },

    async listTypeMappings(runId): Promise<TypeMappingRow[]> {
      const rows = await db.select().from(importTypeMappings).where(eq(importTypeMappings.runId, runId));
      return rows.map((r) => ({ externalType: r.externalType, targetTaskType: r.targetTaskType, targetStatus: r.targetStatus }));
    },

    async listStagedUsers(runId): Promise<StagedUserRow[]> {
      const rows = await db.select().from(importStagedUsers).where(eq(importStagedUsers.runId, runId));
      return rows.map((r) => ({
        id: r.id, runId: r.runId, externalId: r.externalId, displayName: r.displayName ?? null,
        email: r.email ?? null, action: r.action as StagedUserAction, targetUserId: r.targetUserId ?? null,
      }));
    },

    async patchStagedProject(id, patch): Promise<void> {
      await db.update(importStagedProjects).set({
        ...(patch.action !== undefined ? { action: patch.action } : {}),
        ...(patch.targetProjectId !== undefined ? { targetProjectId: patch.targetProjectId } : {}),
        ...(patch.targetProjectName !== undefined ? { targetProjectName: patch.targetProjectName } : {}),
      }).where(eq(importStagedProjects.id, id));
    },

    async patchStagedUser(id, patch): Promise<void> {
      await db.update(importStagedUsers).set({
        ...(patch.action !== undefined ? { action: patch.action } : {}),
        ...(patch.targetUserId !== undefined ? { targetUserId: patch.targetUserId } : {}),
      }).where(eq(importStagedUsers.id, id));
    },

    async patchStagedItemInclude(id, include): Promise<void> {
      await db.update(importStagedItems).set({ include }).where(eq(importStagedItems.id, id));
    },

    async projectKeyExists(key): Promise<boolean> {
      const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.key, key)).limit(1);
      return !!row;
    },

    async insertProject(input): Promise<number> {
      const [row] = await db.insert(projects).values({
        tenantId: input.tenantId,
        segmentId: input.segmentId ?? undefined,
        key: input.key,
        name: input.name,
        description: input.description,
        origin: 'imported',
      }).returning({ id: projects.id });
      if (!row) throw new Error('insertProject returned no row');
      return row.id;
    },

    async projectBelongsToTenant(projectId, tenantId): Promise<boolean> {
      const [row] = await db.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId))).limit(1);
      return !!row;
    },

    async insertTask(input): Promise<number> {
      const now = new Date();
      const rand = crypto.randomUUID().slice(0, 4);
      const key = `${input.source.toUpperCase()}-${input.externalId}-${rand}`.slice(0, 100);
      const [row] = await db.insert(tasks).values({
        projectId: input.projectId,
        segmentId: input.segmentId ?? undefined,
        key,
        title: input.title.slice(0, 500),
        description: input.description,
        status: input.status || 'backlog',
        priority: 'medium',
        taskType: input.taskType === 'epic' ? 'epic' : 'task',
        source: input.source,
        storyPoints: input.storyPoints ?? undefined,
        createdAt: now,
        updatedAt: now,
      }).returning({ id: tasks.id });
      if (!row) throw new Error('insertTask returned no row');
      return row.id;
    },

    async insertConnection(input): Promise<string> {
      const [row] = await db.insert(boardConnections).values({
        tenantId: input.tenantId,
        segmentId: input.segmentId,
        projectId: input.projectId,
        credentialId: input.credentialId,
        provider: input.provider,
        externalBoardId: input.externalBoardId,
      }).returning({ id: boardConnections.id });
      if (!row) throw new Error('insertConnection returned no row');
      return row.id;
    },

    async insertTypeMappings(connectionId, tenantId, segmentId, rows): Promise<void> {
      if (!rows.length) return;
      await db.insert(boardTypeMappings).values(rows.map((r) => ({
        tenantId, segmentId, connectionId, externalType: r.externalType,
        targetTaskType: r.targetTaskType, targetStatus: r.targetStatus,
      }))).onConflictDoNothing();
    },

    async insertTicketLink(input): Promise<void> {
      await db.insert(externalTicketLinks).values({
        tenantId: input.tenantId,
        segmentId: input.segmentId,
        connectionId: input.connectionId,
        taskId: input.taskId,
        provider: input.provider,
        externalId: input.externalId,
        externalUrl: input.externalUrl,
        syncState: 'synced',
        lastInboundAt: new Date(),
      }).onConflictDoNothing();
    },

    async hasMemberOrInvite(tenantId, email): Promise<boolean> {
      const [invite] = await db.select({ id: tenantInvitations.id }).from(tenantInvitations)
        .where(and(eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.email, email), eq(tenantInvitations.status, 'pending'))).limit(1);
      if (invite) return true;
      const [member] = await db.select({ id: tenantMembers.id }).from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(users.email, email))).limit(1);
      return !!member;
    },

    async insertInvitation(input): Promise<void> {
      await db.insert(tenantInvitations).values({
        tenantId: input.tenantId,
        email: input.email,
        invitedByUserId: input.invitedByUserId,
        status: 'pending',
      });
    },
  };
}
