import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the application services so we assert dispatch + tenant-scoping without a DB.
const projectSvc = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  buildUniqueKey: vi.fn(async (tid: number, name: string) => `${tid}-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`),
}));
const taskSvc = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  moveTask: vi.fn(),
}));

// Constructable mocks: a `function` returning an object yields it from `new`.
vi.mock('../project/ProjectService', () => ({ ProjectService: function () { return projectSvc; } }));
vi.mock('../task/TaskService', () => ({ TaskService: function () { return taskSvc; } }));
vi.mock('../../infrastructure/repositories/ProjectRepository', () => ({ ProjectRepository: function () { /* stub */ } }));
vi.mock('../../infrastructure/repositories/TaskRepository', () => ({ TaskRepository: function () { /* stub */ } }));

import {
  listBuiltinTools, callBuiltinTool, BUILTIN_EXTENSION_ID,
  CLOUD_AGENT_PLATFORM_TOOLS, cloudAgentPlatformToolSchemas, resolveCloudAgentPlatformTool,
} from './builtinMcpService';

const db = {} as never;
const TENANT = 7;

beforeEach(() => vi.clearAllMocks());

describe('cloud-agent curated platform tool subset', () => {
  const allToolIds = new Set(listBuiltinTools().map((t) => t.tool));

  it('every curated tool exists in the CATALOG (no typos / stale ids)', () => {
    for (const tool of CLOUD_AGENT_PLATFORM_TOOLS) {
      expect(allToolIds.has(tool), `curated tool '${tool}' not in CATALOG`).toBe(true);
    }
  });

  it('grants NO admin/destructive tools to an unattended agent', () => {
    const forbiddenPrefixes = ['api_keys.', 'security.', 'provider_keys.', 'migrations.', 'agent_hosts.', 'board_connections.', 'cron.', 'integrations.'];
    // The ONE safe exception under `security.`: the Security agent files its SOC 2
    // findings via this tool mid-run. security.configure_access / security.get_access
    // stay forbidden (deciding who can SEE security tickets is an admin action).
    const allowedUnderForbidden = new Set(['security.record_finding']);
    const forbiddenExact = ['executions.submit', 'executions.cancel', 'executions.post_message'];
    for (const tool of CLOUD_AGENT_PLATFORM_TOOLS) {
      if (allowedUnderForbidden.has(tool)) continue;
      expect(forbiddenPrefixes.some((p) => tool.startsWith(p)), `curated tool '${tool}' is admin-surface`).toBe(false);
      expect(forbiddenExact.includes(tool), `curated tool '${tool}' is an execution control-plane mutation`).toBe(false);
      expect(tool.endsWith('.delete'), `curated tool '${tool}' is a delete`).toBe(false);
    }
  });

  it('advertises curated tools as builtin_* OpenAI function schemas', () => {
    const schemas = cloudAgentPlatformToolSchemas();
    expect(schemas.length).toBe(CLOUD_AGENT_PLATFORM_TOOLS.length);
    for (const s of schemas) {
      expect(s.type).toBe('function');
      expect(s.function.name).toMatch(/^builtin_/);
      expect(s.function.parameters.type).toBe('object');
    }
  });

  it('resolves advertised names back to the dotted id ONLY for the curated subset', () => {
    // Round-trips every curated tool…
    for (const s of cloudAgentPlatformToolSchemas()) {
      const resolved = resolveCloudAgentPlatformTool(s.function.name);
      expect(CLOUD_AGENT_PLATFORM_TOOLS.includes(resolved!)).toBe(true);
    }
    // …and refuses an off-list platform tool even if the model names it.
    expect(resolveCloudAgentPlatformTool('builtin_api_keys_create')).toBeUndefined();
    expect(resolveCloudAgentPlatformTool('builtin_tasks_delete')).toBeUndefined();
    expect(resolveCloudAgentPlatformTool('not_a_tool')).toBeUndefined();
  });
});

describe('listBuiltinTools', () => {
  const tools = listBuiltinTools();

  it('advertises projects + tasks as gateway-safe, builtin-tagged tools', () => {
    expect(tools.length).toBeGreaterThanOrEqual(11);
    expect(tools.every((t) => t.extensionId === BUILTIN_EXTENSION_ID)).toBe(true);
    const names = tools.map((t) => t.name);
    expect(names).toContain('builtin_projects_list');
    expect(names).toContain('builtin_projects_create');
    expect(names).toContain('builtin_tasks_create');
    expect(names).toContain('builtin_tasks_move');
    // Additional domains wired server-side (read) [1296].
    expect(names).toContain('builtin_workflows_list');
    expect(names).toContain('builtin_specs_list');
    expect(names).toContain('builtin_prompts_list');
    expect(names).toContain('builtin_approvals_list');
    expect(names).toContain('builtin_agents_list');
    expect(names).toContain('builtin_boards_list');
    expect(names).toContain('builtin_cron_list');
    for (const t of tools) {
      expect(t.name).toMatch(/^builtin_[a-z0-9_]+$/); // flat, no dots
      expect(t.parameters).toMatchObject({ type: 'object' });
      expect(t.description).toBeTruthy();
    }
  });

  it('advertises the OKR / strategy tier (one source for web + VS Code)', () => {
    const names = tools.map((t) => t.name);
    for (const n of [
      'builtin_portfolios_list', 'builtin_portfolios_create',
      'builtin_initiatives_list', 'builtin_initiatives_create',
      'builtin_objectives_list', 'builtin_objectives_create', 'builtin_objectives_add_link',
      'builtin_key_results_create',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('advertises the PMO structure + rollup tools (portfolio section is agent-operable)', () => {
    const names = tools.map((t) => t.name);
    for (const n of ['builtin_pmo_tree', 'builtin_pmo_rollup', 'builtin_pmo_link_project', 'builtin_pmo_add_dependency', 'builtin_pmo_remove_dependency']) {
      expect(names).toContain(n);
    }
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    expect(byName('builtin_pmo_tree').mutates).toBe(false);
    expect(byName('builtin_pmo_rollup').mutates).toBe(false);
    expect(byName('builtin_pmo_link_project').mutates).toBe(true);
    // Reassigning an objective's owner clears the other axes → each owner field must accept null.
    const objUpdate = byName('builtin_objectives_update').parameters as { properties: Record<string, { type?: unknown }> };
    for (const f of ['portfolioId', 'initiativeId', 'projectId']) {
      expect(objUpdate.properties[f]?.type).toContain('null');
    }
  });

  it('advertises the mutates flag so any client can gate writes off one source', () => {
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    expect(byName('builtin_objectives_create').mutates).toBe(true);
    expect(byName('builtin_key_results_create').mutates).toBe(true);
    expect(byName('builtin_objectives_list').mutates).toBe(false);
    expect(byName('builtin_projects_list').mutates).toBe(false);
  });

  it('advertises the attachment read/write tools (the write-back path for uploads)', () => {
    const names = tools.map((t) => t.name);
    expect(names).toContain('builtin_attachments_read');
    expect(names).toContain('builtin_attachments_write');
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    expect(byName('builtin_attachments_read').mutates).toBe(false);
    expect(byName('builtin_attachments_write').mutates).toBe(true);
  });

  it('advertises the migration / integration flow (Brain-callable)', () => {
    const names = tools.map((t) => t.name);
    for (const n of [
      'builtin_integrations_providers', 'builtin_integrations_create_credential', 'builtin_integrations_test',
      'builtin_migrations_start', 'builtin_migrations_get', 'builtin_migrations_set_mappings',
      'builtin_migrations_stage', 'builtin_migrations_commit',
    ]) {
      expect(names).toContain(n);
    }
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    expect(byName('builtin_integrations_providers').mutates).toBe(false);
    expect(byName('builtin_integrations_create_credential').mutates).toBe(true);
    expect(byName('builtin_migrations_commit').mutates).toBe(true);
    expect(byName('builtin_migrations_get').mutates).toBe(false);
  });

  it('has globally-unique advertised names', () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('callBuiltinTool', () => {
  it('dispatches a read to the service, tenant-scoped', async () => {
    projectSvc.listProjects.mockResolvedValue([{ toPlain: () => ({ id: 1, name: 'P' }) }]);
    const res = await callBuiltinTool(db, { tenantId: TENANT, tool: 'projects.list', arguments: {} });
    expect(projectSvc.listProjects).toHaveBeenCalledWith(TENANT);
    // projects.list returns a compact projection inside a paging envelope so the
    // Brain's context stays bounded (see LIST_DEFAULT_LIMIT / listEnvelope).
    expect(res).toEqual({ projects: [{ id: 1, name: 'P' }], total: 1, returned: 1, truncated: false });
  });

  it('mints a key + tenant on create', async () => {
    projectSvc.createProject.mockResolvedValue({ toPlain: () => ({ id: 2 }) });
    await callBuiltinTool(db, { tenantId: TENANT, tool: 'projects.create', arguments: { name: 'Acme App' } });
    expect(projectSvc.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, name: 'Acme App', key: expect.stringContaining('ACME') }),
    );
  });

  it('rejects create without a name', async () => {
    await expect(callBuiltinTool(db, { tenantId: TENANT, tool: 'projects.create', arguments: {} })).rejects.toThrow(/name is required/);
  });

  it('passes tenant through to createTask', async () => {
    taskSvc.createTask.mockResolvedValue({ toPlain: () => ({ id: 5 }) });
    await callBuiltinTool(db, { tenantId: TENANT, tool: 'tasks.create', arguments: { projectId: 3, title: 'Do it' } });
    expect(taskSvc.createTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: 3, title: 'Do it' }), TENANT);
  });

  it('tasks.create is idempotent — a same-title task on the project is returned, not duplicated', async () => {
    // Existing board already has "Ship OKRs"; a re-run with different casing/spacing must dedup.
    taskSvc.listTasks.mockResolvedValue([{ toPlain: () => ({ id: 42, title: 'Ship OKRs', projectId: 3 }) }]);
    const res = await callBuiltinTool(db, { tenantId: TENANT, tool: 'tasks.create', arguments: { projectId: 3, title: '  ship   okrs ' } });
    expect(taskSvc.createTask).not.toHaveBeenCalled();
    expect(res).toMatchObject({ deduped: true, id: 42, title: 'Ship OKRs' });
  });

  it('enforces tenant ownership on tasks.update (via the project lookup)', async () => {
    taskSvc.getTask.mockResolvedValue({ projectId: 4, toPlain: () => ({ id: 9 }) });
    projectSvc.getProject.mockResolvedValue({ id: 4 });
    taskSvc.updateTask.mockResolvedValue({ toPlain: () => ({ id: 9, title: 'x' }) });
    await callBuiltinTool(db, { tenantId: TENANT, tool: 'tasks.update', arguments: { id: 9, title: 'x' } });
    expect(taskSvc.getTask).toHaveBeenCalledWith(9);
    expect(projectSvc.getProject).toHaveBeenCalledWith(4, TENANT); // ownership guard
    expect(taskSvc.updateTask).toHaveBeenCalled();
  });

  it('throws on an unknown tool', async () => {
    await expect(callBuiltinTool(db, { tenantId: TENANT, tool: 'projects.nuke', arguments: {} })).rejects.toThrow(/Unknown built-in tool/);
  });
});

describe('attachments tools (Brain uploads, R2-backed)', () => {
  // A fake R2 bucket over an in-memory Map — get/head/put are all the tools use.
  const fakeEnv = (store: Map<string, string>) => ({
    UPLOADS: {
      get: async (k: string) => (store.has(k) ? { text: async () => store.get(k)! } : null),
      head: async (k: string) => (store.has(k) ? { httpMetadata: { contentType: 'text/markdown' }, customMetadata: { originalName: 'ROADMAP.md' } } : null),
      put: async (k: string, v: string) => { store.set(k, String(v)); },
    },
  }) as never;

  it('attachments.read returns a paginated window for a tenant-owned key', async () => {
    const store = new Map([[`${TENANT}/u/rm.md`, 'HELLO WORLD']]);
    const res = await callBuiltinTool(db, { tenantId: TENANT, tool: 'attachments.read', arguments: { key: `${TENANT}/u/rm.md`, offset: 0, limit: 5 }, env: fakeEnv(store) });
    expect(res).toMatchObject({ key: `${TENANT}/u/rm.md`, content: 'HELLO', offset: 0, returned: 5, total: 11, truncated: true });
  });

  it('attachments.read refuses a key owned by another tenant', async () => {
    const store = new Map([['99/u/secret.md', 'top secret']]);
    await expect(callBuiltinTool(db, { tenantId: TENANT, tool: 'attachments.read', arguments: { key: '99/u/secret.md' }, env: fakeEnv(store) })).rejects.toThrow(/not found/);
  });

  it('attachments.write overwrites an owned attachment in place (the real write-back path)', async () => {
    const store = new Map([[`${TENANT}/u/rm.md`, 'old body']]);
    const res = await callBuiltinTool(db, { tenantId: TENANT, tool: 'attachments.write', arguments: { key: `${TENANT}/u/rm.md`, content: 'new body' }, env: fakeEnv(store) });
    expect(res).toMatchObject({ key: `${TENANT}/u/rm.md`, size: 8, updated: true });
    expect(store.get(`${TENANT}/u/rm.md`)).toBe('new body');
  });

  it('attachments.write will not create/overwrite a missing or foreign key', async () => {
    const store = new Map<string, string>();
    await expect(callBuiltinTool(db, { tenantId: TENANT, tool: 'attachments.write', arguments: { key: `${TENANT}/u/nope.md`, content: 'x' }, env: fakeEnv(store) })).rejects.toThrow(/not found/);
    expect(store.size).toBe(0);
  });
});
