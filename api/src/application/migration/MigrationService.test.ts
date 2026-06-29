import { describe, it, expect } from 'vitest';
import { MigrationService, type MigrationStore, type ProviderForBoard } from './MigrationService';
import type { BoardProvider, DiscoveryResult, FetchPage } from '../boardsync/providers';

// ---------------------------------------------------------------------------
// In-memory MigrationStore fake (no DB). Records the side-effects commit() makes.
// ---------------------------------------------------------------------------

function makeStore() {
  const runs = new Map<string, any>();
  const stagedProjects = new Map<string, any[]>();
  const typeMappings = new Map<string, any[]>();
  const stagedUsers = new Map<string, any[]>();
  const stagedItems = new Map<string, any[]>();
  const inserts = {
    projects: [] as any[],
    tasks: [] as any[],
    connections: [] as any[],
    typeMappings: [] as any[],
    links: [] as any[],
    invitations: [] as any[],
  };
  let seq = 1;
  const existingKeys = new Set<string>();
  const tenantProjects = new Set<number>([999]); // a pre-existing project for "map"

  const store: MigrationStore = {
    async createRun(input) {
      const id = `run-${seq++}`;
      const row = { id, ...input, status: 'discovering', summary: null, errorMessage: null };
      runs.set(id, row);
      return row as any;
    },
    async getRun(runId, tenantId) {
      const r = runs.get(runId);
      return r && r.tenantId === tenantId ? { ...r } : null;
    },
    async listRuns(tenantId) { return [...runs.values()].filter((r) => r.tenantId === tenantId); },
    async updateRun(runId, patch) { Object.assign(runs.get(runId), patch); },
    async deleteRun(runId) { runs.delete(runId); },
    async replaceStagedProjects(runId, _t, rows) {
      stagedProjects.set(runId, rows.map((r, i) => ({ id: `sp-${runId}-${i}`, runId, ...r })));
    },
    async replaceTypeMappings(runId, _t, rows) { typeMappings.set(runId, rows.map((r) => ({ ...r }))); },
    async replaceStagedUsers(runId, _t, rows) {
      stagedUsers.set(runId, rows.map((r, i) => ({ id: `su-${runId}-${i}`, runId, ...r })));
    },
    async replaceStagedItems(runId, _t, rows) {
      stagedItems.set(runId, rows.map((r, i) => ({ id: `si-${runId}-${i}`, runId, ...r })));
    },
    async listStagedProjects(runId) { return (stagedProjects.get(runId) ?? []).map((r) => ({ ...r })); },
    async listStagedItems(runId) { return (stagedItems.get(runId) ?? []).map((r) => ({ ...r })); },
    async listTypeMappings(runId) { return (typeMappings.get(runId) ?? []).map((r) => ({ ...r })); },
    async listStagedUsers(runId) { return (stagedUsers.get(runId) ?? []).map((r) => ({ ...r })); },
    async patchStagedProject(id, patch) {
      for (const list of stagedProjects.values()) { const row = list.find((r) => r.id === id); if (row) Object.assign(row, patch); }
    },
    async patchStagedUser(id, patch) {
      for (const list of stagedUsers.values()) { const row = list.find((r) => r.id === id); if (row) Object.assign(row, patch); }
    },
    async patchStagedItemInclude(id, include) {
      for (const list of stagedItems.values()) { const row = list.find((r) => r.id === id); if (row) row.include = include; }
    },
    async projectKeyExists(key) { return existingKeys.has(key); },
    async insertProject(input) {
      existingKeys.add(input.key);
      const id = 1000 + inserts.projects.length;
      tenantProjects.add(id);
      inserts.projects.push({ id, ...input });
      return id;
    },
    async projectBelongsToTenant(projectId) { return tenantProjects.has(projectId); },
    async insertTask(input) { const id = 5000 + inserts.tasks.length; inserts.tasks.push({ id, ...input }); return id; },
    async insertConnection(input) { const id = `conn-${inserts.connections.length}`; inserts.connections.push({ id, ...input }); return id; },
    async insertTypeMappings(connectionId, _t, _s, rows) { inserts.typeMappings.push({ connectionId, rows }); },
    async insertTicketLink(input) { inserts.links.push({ ...input }); },
    async hasMemberOrInvite() { return false; },
    async insertInvitation(input) { inserts.invitations.push({ ...input }); },
  };

  return { store, inserts, runs };
}

// A fake provider: discover() returns 2 projects, 2 types, 1 user; fetch returns 2 tickets per project.
function makeProvider(): BoardProvider {
  const discovery: DiscoveryResult = {
    projects: [
      { externalId: 'ENG', key: 'ENG', name: 'Engineering', itemCount: 2 },
      { externalId: 'OPS', key: 'OPS', name: 'Operations', itemCount: 1 },
    ],
    itemTypes: [
      { externalType: 'Story', name: 'Story', category: 'story' },
      { externalType: 'Epic', name: 'Epic', category: 'epic' },
    ],
    users: [{ externalId: 'u1', displayName: 'Ada', email: 'ada@example.com' }],
  };
  return {
    id: 'jira',
    async discover() { return discovery; },
    async fetchTicketsSince(): Promise<FetchPage> {
      return {
        tickets: [
          { externalId: 'T-1', externalUrl: null, externalVersion: '1', title: 'Story one', body: 'b', state: 'open', source: 'jira', contentHash: 'h1', fields: {}, externalType: 'Story' },
          { externalId: 'T-2', externalUrl: null, externalVersion: '1', title: 'Epic one', body: 'b', state: 'open', source: 'jira', contentHash: 'h2', fields: {}, externalType: 'Epic' },
        ],
        nextCursor: null,
      };
    },
    async pushUpdate() {},
  };
}

const meta = { tenantId: 1, segmentId: null, provider: 'jira', credentialId: 'cred-1', mode: 'both' as const, createdBy: 'user-1' };

describe('MigrationService', () => {
  it('discovers and stages projects, types and users', async () => {
    const { store } = makeStore();
    const svc = new MigrationService(store);
    const detail = await svc.startRun(meta, makeProvider());

    expect(detail.run.status).toBe('staged');
    expect(detail.projects).toHaveLength(2);
    expect(detail.itemTypes).toHaveLength(2);
    // Epic type seeds to task_type 'epic' heuristically.
    expect(detail.itemTypes.find((t) => t.externalType === 'Epic')?.targetTaskType).toBe('epic');
    expect(detail.users[0]!.action).toBe('invite');
  });

  it('combines two external projects into one BF project and imports tasks with type mapping', async () => {
    const { store, inserts } = makeStore();
    const svc = new MigrationService(store);
    const { run, projects } = await svc.startRun(meta, makeProvider());

    // Map BOTH external projects onto the SAME existing BF project (combine).
    await svc.setMappings(run.id, 1, {
      projects: projects.map((p) => ({ id: p.id, action: 'map', targetProjectId: 999 })),
    });

    const factory: ProviderForBoard = () => makeProvider();
    await svc.stageItems(run.id, 1, factory);
    const final = await svc.commit(run.id, 1, factory);

    expect(final.status).toBe('completed');
    // No new projects (both mapped to existing 999); 2 projects × 2 items = 4 tasks.
    expect(inserts.projects).toHaveLength(0);
    expect(inserts.tasks).toHaveLength(4);
    // Epic-typed item maps to task_type 'epic'.
    expect(inserts.tasks.filter((t) => t.taskType === 'epic')).toHaveLength(2);
    // sync mode → a connection per external project + idempotency links.
    expect(inserts.connections).toHaveLength(2);
    expect(inserts.links).toHaveLength(4);
    // user invited (email present).
    expect(inserts.invitations).toHaveLength(1);
  });

  it('creates new projects for action=create and skips action=skip', async () => {
    const { store, inserts } = makeStore();
    const svc = new MigrationService(store);
    const { run, projects } = await svc.startRun({ ...meta, mode: 'migrate' }, makeProvider());

    await svc.setMappings(run.id, 1, {
      projects: [
        { id: projects[0]!.id, action: 'create', targetProjectName: 'New Eng' },
        { id: projects[1]!.id, action: 'skip' },
      ],
    });
    const factory: ProviderForBoard = () => makeProvider();
    await svc.stageItems(run.id, 1, factory);
    await svc.commit(run.id, 1, factory);

    expect(inserts.projects).toHaveLength(1);
    expect(inserts.projects[0].name).toBe('New Eng');
    // migrate mode (no sync) → no connections/links.
    expect(inserts.connections).toHaveLength(0);
    expect(inserts.links).toHaveLength(0);
    // Only the non-skipped project's 2 items become tasks.
    expect(inserts.tasks).toHaveLength(2);
  });
});
