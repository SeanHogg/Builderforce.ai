/**
 * MigrationService — the "stage before it lands" importer behind the Migration
 * wizard. Built on the boardsync provider framework: a provider's discover()
 * enumerates the external projects/types/users, the operator maps + combines
 * them, we stage the items, and only commit() promotes anything into the real
 * projects/tasks/members tables.
 *
 * Like SyncEngine, all persistence goes through a narrow port (MigrationStore)
 * so the orchestration is unit-testable with an in-memory fake and zero DB/network.
 *
 * Two modes share the discover→map→stage pipeline:
 *   migrate — one-time import of historical items into BF tasks.
 *   sync    — set up an ongoing board_connection (+ type mapping) for continuous poll.
 *   both    — import history AND set up the ongoing connection.
 */

import type { BoardProvider, DiscoveryResult } from '../boardsync/providers';

export type ImportMode = 'migrate' | 'sync' | 'both';
export type ImportRunStatus =
  | 'discovering' | 'staged' | 'mapped' | 'importing' | 'completed' | 'failed' | 'cancelled';
export type StagedProjectAction = 'create' | 'map' | 'skip';
export type StagedUserAction = 'invite' | 'map' | 'skip';

export interface RunRow {
  id: string;
  tenantId: number;
  segmentId: string | null;
  provider: string;
  credentialId: string | null;
  mode: ImportMode;
  status: ImportRunStatus;
  summary: Record<string, number> | null;
  errorMessage: string | null;
  createdBy: string | null;
}

export interface StagedProjectRow {
  id: string;
  runId: string;
  externalId: string;
  externalKey: string | null;
  name: string;
  description: string | null;
  externalUrl: string | null;
  itemCount: number | null;
  action: StagedProjectAction;
  targetProjectId: number | null;
  targetProjectName: string | null;
}

export interface StagedItemRow {
  id: string;
  runId: string;
  stagedProjectId: string;
  externalId: string;
  externalType: string | null;
  externalUrl: string | null;
  title: string;
  body: string | null;
  state: string | null;
  storyPoints: number | null;
  assigneeExternalId: string | null;
  externalVersion: string | null;
  contentHash: string | null;
  targetTaskType: string;
  targetStatus: string;
  include: boolean;
}

export interface TypeMappingRow {
  externalType: string;
  targetTaskType: string;
  targetStatus: string;
}

export interface StagedUserRow {
  id: string;
  runId: string;
  externalId: string;
  displayName: string | null;
  email: string | null;
  action: StagedUserAction;
  targetUserId: string | null;
}

/** The full staging snapshot returned to the wizard. */
export interface RunDetail {
  run: RunRow;
  projects: StagedProjectRow[];
  itemTypes: TypeMappingRow[];
  users: StagedUserRow[];
  items: StagedItemRow[];
}

/** Mapping edits posted from the wizard. */
export interface MappingInput {
  projects?: Array<{ id: string; action?: StagedProjectAction; targetProjectId?: number | null; targetProjectName?: string | null }>;
  types?: Array<{ externalType: string; targetTaskType: string; targetStatus: string }>;
  users?: Array<{ id: string; action?: StagedUserAction; targetUserId?: string | null }>;
  items?: Array<{ id: string; include: boolean }>;
}

/** Narrow persistence port — one logical DB op per method. */
export interface MigrationStore {
  createRun(input: { tenantId: number; segmentId: string | null; provider: string; credentialId: string | null; mode: ImportMode; createdBy: string | null }): Promise<RunRow>;
  getRun(runId: string, tenantId: number): Promise<RunRow | null>;
  listRuns(tenantId: number): Promise<RunRow[]>;
  updateRun(runId: string, patch: { status?: ImportRunStatus; summary?: Record<string, number> | null; errorMessage?: string | null }): Promise<void>;
  deleteRun(runId: string, tenantId: number): Promise<void>;

  replaceStagedProjects(runId: string, tenantId: number, rows: Array<Omit<StagedProjectRow, 'id' | 'runId'>>): Promise<void>;
  replaceTypeMappings(runId: string, tenantId: number, rows: TypeMappingRow[]): Promise<void>;
  replaceStagedUsers(runId: string, tenantId: number, rows: Array<Omit<StagedUserRow, 'id' | 'runId'>>): Promise<void>;
  replaceStagedItems(runId: string, tenantId: number, rows: Array<Omit<StagedItemRow, 'id' | 'runId'>>): Promise<void>;

  listStagedProjects(runId: string): Promise<StagedProjectRow[]>;
  listStagedItems(runId: string): Promise<StagedItemRow[]>;
  listTypeMappings(runId: string): Promise<TypeMappingRow[]>;
  listStagedUsers(runId: string): Promise<StagedUserRow[]>;

  patchStagedProject(id: string, patch: { action?: StagedProjectAction; targetProjectId?: number | null; targetProjectName?: string | null }): Promise<void>;
  patchStagedUser(id: string, patch: { action?: StagedUserAction; targetUserId?: string | null }): Promise<void>;
  patchStagedItemInclude(id: string, include: boolean): Promise<void>;

  // ── commit helpers ──
  /** True if a project key is already taken (any tenant — keys are globally unique). */
  projectKeyExists(key: string): Promise<boolean>;
  /** Insert a new BF project, returning its id. */
  insertProject(input: { tenantId: number; segmentId: string | null; key: string; name: string; description: string | null }): Promise<number>;
  /** Confirm a project belongs to the tenant (for action='map'). */
  projectBelongsToTenant(projectId: number, tenantId: number): Promise<boolean>;
  /** Insert a task, returning its id. externalId + source seed a unique key. */
  insertTask(input: { tenantId: number; projectId: number; segmentId: string | null; title: string; description: string | null; taskType: string; status: string; storyPoints: number | null; source: string; externalId: string; assignedUserId: string | null }): Promise<number>;
  /** Create an ongoing board connection, returning its id. */
  insertConnection(input: { tenantId: number; segmentId: string | null; projectId: number; credentialId: string | null; provider: string; externalBoardId: string | null }): Promise<string>;
  /** Seed the persistent type mapping for a connection. */
  insertTypeMappings(connectionId: string, tenantId: number, segmentId: string | null, rows: TypeMappingRow[]): Promise<void>;
  /** Create the idempotency link so a later sync recognises the imported task. */
  insertTicketLink(input: { tenantId: number; segmentId: string | null; connectionId: string; taskId: number; provider: string; externalId: string; externalUrl: string | null; externalVersion: string | null; contentHash: string | null }): Promise<void>;
  /** Whether an email is already a member or pending invite of the tenant. */
  hasMemberOrInvite(tenantId: number, email: string): Promise<boolean>;
  /** Create a pending workspace invitation. */
  insertInvitation(input: { tenantId: number; email: string; invitedByUserId: string | null }): Promise<void>;
}

/** Builds a provider scoped to one external board (null = account-wide for discover). */
export type ProviderForBoard = (externalBoardId: string | null) => BoardProvider;

/** Bounded pages drained per project when staging items (mirrors boardsync MAX_SYNC_PAGES). */
const MAX_STAGE_PAGES = 20;

/** Derive a heuristic BF task type from a discovered item type's category/name. */
function defaultTaskType(category: string | null | undefined, name: string): string {
  const hint = (category ?? name).toLowerCase();
  return hint.includes('epic') || hint.includes('feature') ? 'epic' : 'task';
}

/** Slugify a project name into a candidate uppercase key (letters/digits only). */
function keyCandidate(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (cleaned.slice(0, 8) || 'IMP');
}

export class MigrationService {
  constructor(private readonly store: MigrationStore) {}

  /** Step 1 — create a run, discover the external system, stage projects/types/users. */
  async startRun(
    meta: { tenantId: number; segmentId: string | null; provider: string; credentialId: string | null; mode: ImportMode; createdBy: string | null },
    provider: BoardProvider,
  ): Promise<RunDetail> {
    if (typeof provider.discover !== 'function') {
      throw new Error(`Provider ${meta.provider} does not support discovery`);
    }
    const run = await this.store.createRun(meta);
    try {
      const discovery: DiscoveryResult = await provider.discover();

      await this.store.replaceStagedProjects(run.id, meta.tenantId, discovery.projects.map((p) => ({
        externalId: p.externalId,
        externalKey: p.key ?? null,
        name: p.name,
        description: p.description ?? null,
        externalUrl: p.url ?? null,
        itemCount: p.itemCount ?? null,
        action: 'create' as const,
        targetProjectId: null,
        targetProjectName: p.name,
      })));

      await this.store.replaceTypeMappings(run.id, meta.tenantId, discovery.itemTypes.map((t) => ({
        externalType: t.externalType,
        targetTaskType: defaultTaskType(t.category, t.name),
        targetStatus: 'backlog',
      })));

      await this.store.replaceStagedUsers(run.id, meta.tenantId, discovery.users.map((u) => ({
        externalId: u.externalId,
        displayName: u.displayName,
        email: u.email ?? null,
        action: (u.email ? 'invite' : 'skip') as StagedUserAction,
        targetUserId: null,
      })));

      const summary = { projects: discovery.projects.length, itemTypes: discovery.itemTypes.length, users: discovery.users.length };
      await this.store.updateRun(run.id, { status: 'staged', summary });
      return this.getDetail(run.id, meta.tenantId) as Promise<RunDetail>;
    } catch (err) {
      await this.store.updateRun(run.id, { status: 'failed', errorMessage: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /** Step 2 — persist project/type/user mappings + item include toggles. */
  async setMappings(runId: string, tenantId: number, input: MappingInput): Promise<RunDetail> {
    const run = await this.requireRun(runId, tenantId);
    for (const p of input.projects ?? []) {
      await this.store.patchStagedProject(p.id, { action: p.action, targetProjectId: p.targetProjectId, targetProjectName: p.targetProjectName });
    }
    if (input.types) {
      await this.store.replaceTypeMappings(runId, tenantId, input.types.map((t) => ({
        externalType: t.externalType,
        targetTaskType: t.targetTaskType === 'epic' ? 'epic' : 'task',
        targetStatus: t.targetStatus || 'backlog',
      })));
    }
    for (const u of input.users ?? []) {
      await this.store.patchStagedUser(u.id, { action: u.action, targetUserId: u.targetUserId });
    }
    for (const it of input.items ?? []) {
      await this.store.patchStagedItemInclude(it.id, it.include);
    }
    if (run.status === 'staged') await this.store.updateRun(runId, { status: 'mapped' });
    return this.getDetail(runId, tenantId) as Promise<RunDetail>;
  }

  /** Step 3 — pull items for every non-skipped project into staging, applying type mapping. */
  async stageItems(runId: string, tenantId: number, buildProvider: ProviderForBoard): Promise<RunDetail> {
    await this.requireRun(runId, tenantId);
    const projects = (await this.store.listStagedProjects(runId)).filter((p) => p.action !== 'skip');
    const typeMap = new Map((await this.store.listTypeMappings(runId)).map((t) => [t.externalType.toLowerCase(), t]));

    const staged: Array<Omit<StagedItemRow, 'id' | 'runId'>> = [];
    for (const proj of projects) {
      const provider = buildProvider(proj.externalId);
      let cursor: string | null = null;
      for (let page = 0; page < MAX_STAGE_PAGES; page += 1) {
        const result = await provider.fetchTicketsSince(cursor);
        for (const t of result.tickets) {
          const mapped = t.externalType ? typeMap.get(t.externalType.toLowerCase()) : undefined;
          staged.push({
            stagedProjectId: proj.id,
            externalId: t.externalId,
            externalType: t.externalType ?? null,
            externalUrl: t.externalUrl,
            title: t.title,
            body: t.body,
            state: t.state,
            storyPoints: t.storyPoints ?? null,
            assigneeExternalId: t.assigneeExternalId ?? null,
            externalVersion: t.externalVersion ?? null,
            contentHash: t.contentHash ?? null,
            targetTaskType: mapped?.targetTaskType ?? 'task',
            targetStatus: mapped?.targetStatus ?? 'backlog',
            include: true,
          });
        }
        // Stop when the cursor stops advancing (drained) or no items returned.
        if (!result.nextCursor || result.nextCursor === cursor || result.tickets.length === 0) break;
        cursor = result.nextCursor;
      }
    }

    await this.store.replaceStagedItems(runId, tenantId, staged);
    const detail = await this.getDetail(runId, tenantId) as RunDetail;
    await this.store.updateRun(runId, { status: 'mapped', summary: { ...(detail.run.summary ?? {}), items: staged.length } });
    return this.getDetail(runId, tenantId) as Promise<RunDetail>;
  }

  /** Step 4 — promote staged data into real projects/tasks/members (+ optional ongoing sync). */
  async commit(runId: string, tenantId: number, buildProvider: ProviderForBoard): Promise<RunRow> {
    const run = await this.requireRun(runId, tenantId);
    await this.store.updateRun(runId, { status: 'importing' });
    try {
      const wantsSync = run.mode === 'sync' || run.mode === 'both';
      const wantsMigrate = run.mode === 'migrate' || run.mode === 'both';

      const projects = (await this.store.listStagedProjects(runId)).filter((p) => p.action !== 'skip');
      const typeMappings = await this.store.listTypeMappings(runId);
      const users = await this.store.listStagedUsers(runId);
      const items = (await this.store.listStagedItems(runId)).filter((i) => i.include);

      // Resolve each staged project → a real BF project id (create or map/combine).
      const projectIdByStaged = new Map<string, number>();
      const connectionByStaged = new Map<string, string>();
      let projectsCreated = 0;
      let connectionsCreated = 0;
      for (const sp of projects) {
        let bfProjectId: number;
        if (sp.action === 'map' && sp.targetProjectId != null) {
          if (!(await this.store.projectBelongsToTenant(sp.targetProjectId, tenantId))) {
            throw new Error(`Target project ${sp.targetProjectId} not in this workspace`);
          }
          bfProjectId = sp.targetProjectId;
        } else {
          const key = await this.allocateKey(sp.targetProjectName || sp.name);
          bfProjectId = await this.store.insertProject({ tenantId, segmentId: run.segmentId, key, name: sp.targetProjectName || sp.name, description: sp.description });
          projectsCreated += 1;
        }
        projectIdByStaged.set(sp.id, bfProjectId);

        // Ongoing sync: one connection per external board, scoped to its external id.
        if (wantsSync) {
          const connId = await this.store.insertConnection({ tenantId, segmentId: run.segmentId, projectId: bfProjectId, credentialId: run.credentialId, provider: run.provider, externalBoardId: sp.externalId });
          connectionByStaged.set(sp.id, connId);
          connectionsCreated += 1;
          if (typeMappings.length) await this.store.insertTypeMappings(connId, tenantId, run.segmentId, typeMappings);
        }
      }

      // Users — invite by email (skip ones already a member/invite); 'map' is a no-op.
      let usersInvited = 0;
      // Map external user id → existing BF user id (only 'map' users carry one).
      const userIdByExternal = new Map<string, string>();
      for (const u of users) {
        if (u.action === 'map' && u.targetUserId) userIdByExternal.set(u.externalId, u.targetUserId);
        if (u.action !== 'invite' || !u.email) continue;
        if (await this.store.hasMemberOrInvite(tenantId, u.email.toLowerCase())) continue;
        await this.store.insertInvitation({ tenantId, email: u.email.toLowerCase(), invitedByUserId: run.createdBy });
        usersInvited += 1;
      }

      // Items — create tasks (the import) + idempotency links when syncing.
      let tasksCreated = 0;
      let tasksAssigned = 0;
      if (wantsMigrate || wantsSync) {
        for (const item of items) {
          const bfProjectId = projectIdByStaged.get(item.stagedProjectId);
          if (bfProjectId == null) continue;
          const assignedUserId = item.assigneeExternalId ? (userIdByExternal.get(item.assigneeExternalId) ?? null) : null;
          if (assignedUserId) tasksAssigned += 1;
          const taskId = await this.store.insertTask({
            tenantId,
            projectId: bfProjectId,
            segmentId: run.segmentId,
            title: item.title,
            description: item.body,
            taskType: item.targetTaskType === 'epic' ? 'epic' : 'task',
            status: item.targetStatus || 'backlog',
            storyPoints: item.storyPoints,
            source: run.provider,
            externalId: item.externalId,
            assignedUserId,
          });
          tasksCreated += 1;
          const connId = connectionByStaged.get(item.stagedProjectId);
          if (connId) {
            await this.store.insertTicketLink({ tenantId, segmentId: run.segmentId, connectionId: connId, taskId, provider: run.provider, externalId: item.externalId, externalUrl: item.externalUrl, externalVersion: item.externalVersion, contentHash: item.contentHash });
          }
        }
      }

      const summary = { ...(run.summary ?? {}), projectsCreated, connectionsCreated, usersInvited, tasksCreated, tasksAssigned };
      await this.store.updateRun(runId, { status: 'completed', summary });
      return (await this.store.getRun(runId, tenantId))!;
    } catch (err) {
      await this.store.updateRun(runId, { status: 'failed', errorMessage: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async getDetail(runId: string, tenantId: number): Promise<RunDetail | null> {
    const run = await this.store.getRun(runId, tenantId);
    if (!run) return null;
    const [projects, itemTypes, users, items] = await Promise.all([
      this.store.listStagedProjects(runId),
      this.store.listTypeMappings(runId),
      this.store.listStagedUsers(runId),
      this.store.listStagedItems(runId),
    ]);
    return { run, projects, itemTypes, users, items };
  }

  listRuns(tenantId: number): Promise<RunRow[]> {
    return this.store.listRuns(tenantId);
  }

  async cancel(runId: string, tenantId: number): Promise<void> {
    await this.requireRun(runId, tenantId);
    await this.store.updateRun(runId, { status: 'cancelled' });
  }

  async discard(runId: string, tenantId: number): Promise<void> {
    await this.requireRun(runId, tenantId);
    await this.store.deleteRun(runId, tenantId);
  }

  /** Find a free, globally-unique project key derived from the name. */
  private async allocateKey(name: string): Promise<string> {
    const base = keyCandidate(name);
    if (!(await this.store.projectKeyExists(base))) return base;
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${base.slice(0, 6)}${n}`;
      if (!(await this.store.projectKeyExists(candidate))) return candidate;
    }
    throw new Error(`Could not allocate a unique project key for "${name}"`);
  }

  private async requireRun(runId: string, tenantId: number): Promise<RunRow> {
    const run = await this.store.getRun(runId, tenantId);
    if (!run) throw new Error('Migration run not found');
    return run;
  }
}
