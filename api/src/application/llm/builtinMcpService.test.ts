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

import { listBuiltinTools, callBuiltinTool, BUILTIN_EXTENSION_ID } from './builtinMcpService';

const db = {} as never;
const TENANT = 7;

beforeEach(() => vi.clearAllMocks());

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
      expect(t.name).toMatch(/^builtin_[a-z_]+$/); // flat, no dots
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

  it('advertises the mutates flag so any client can gate writes off one source', () => {
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    expect(byName('builtin_objectives_create').mutates).toBe(true);
    expect(byName('builtin_key_results_create').mutates).toBe(true);
    expect(byName('builtin_objectives_list').mutates).toBe(false);
    expect(byName('builtin_projects_list').mutates).toBe(false);
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
    expect(res).toEqual([{ id: 1, name: 'P' }]);
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
