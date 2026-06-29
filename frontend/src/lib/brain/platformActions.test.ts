import { describe, it, expect, vi, beforeEach } from 'vitest';

// Override only the two methods the dispatch/promotion tests exercise; the rest
// of the real client imports cleanly (no network at import time).
vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>();
  return { ...mod, createProject: vi.fn().mockResolvedValue({ id: 42, name: 'Acme' }) };
});
vi.mock('@/lib/builderforceApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/builderforceApi')>();
  // A full Task row (the list endpoint returns these); the brain tasks.list slims
  // it. Defined inside the factory because vi.mock is hoisted above module scope.
  const fullTask = {
    id: 1, projectId: 9, key: 'ACME-1', title: 'Fix login error',
    description: 'x'.repeat(5000), // the multi-KB body the slim projection drops
    status: 'todo', priority: 'high', taskType: 'task', parentTaskId: null,
    sprintId: null, assignedAgentType: null, assignedAgentHostId: null,
    assignedAgentRef: null, assignedUserId: null, gitBranch: null, explicitRepoId: null,
    githubPrUrl: null, githubPrNumber: null, startDate: null, dueDate: null,
    persona: null, archived: false,
  };
  return { ...mod, tasksApi: { ...mod.tasksApi, list: vi.fn().mockResolvedValue([fullTask]) } };
});

// Standalone copy for the pure toSlimTask test (not used by the hoisted mock).
const FULL_TASK = {
  id: 1, projectId: 9, key: 'ACME-1', title: 'Fix login error',
  description: 'x'.repeat(5000), status: 'todo', priority: 'high', taskType: 'task',
  parentTaskId: null, sprintId: null, assignedAgentType: null, assignedAgentHostId: null,
  assignedAgentRef: null, assignedUserId: null, gitBranch: null, explicitRepoId: null,
  githubPrUrl: null, githubPrNumber: null, startDate: null, dueDate: null,
  persona: null, archived: false,
};

import { buildPlatformActions, buildPlatformCapabilities, focusDomainsForPath, toSlimTask, type PlatformActionContext } from './platformActions';
import * as api from '@/lib/api';
import { tasksApi, integrationsApi } from '@/lib/builderforceApi';

function makeCtx() {
  const navigate = vi.fn();
  const ctx: PlatformActionContext = { navigate, getTenantId: () => 7 };
  return { ctx, navigate };
}

const actionByName = (name: string) => buildPlatformActions(makeCtx().ctx).find((a) => a.name === name);

beforeEach(() => vi.clearAllMocks());

describe('platform capability manifest', () => {
  const caps = buildPlatformCapabilities(makeCtx().ctx);

  it('is non-empty and well-formed', () => {
    expect(caps.length).toBeGreaterThan(50);
    for (const c of caps) {
      expect(c.domain).toBeTruthy();
      expect(c.method).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(c.parameters).toMatchObject({ type: 'object' });
      expect(typeof c.run).toBe('function');
      expect(typeof c.mutates).toBe('boolean');
    }
  });

  it('has globally-unique domain.method keys', () => {
    const keys = caps.map((c) => `${c.domain}.${c.method}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('flags writes as mutating and reads as not', () => {
    const create = caps.find((c) => c.domain === 'projects' && c.method === 'create');
    const list = caps.find((c) => c.domain === 'projects' && c.method === 'list');
    expect(create?.mutates).toBe(true);
    expect(list?.mutates).toBe(false);
  });
});

describe('buildPlatformActions', () => {
  it('exposes navigation, dispatcher, and the Tier-1 promoted tools', () => {
    const names = buildPlatformActions(makeCtx().ctx).map((a) => a.name);
    for (const expected of [
      'navigate_to', 'open_project', 'list_platform_capabilities', 'call_platform_capability',
      'create_project', 'update_project', 'delete_project', 'list_projects',
      'list_tasks', 'create_task', 'run_workflow', 'create_spec',
      'hire_agent', 'create_cloud_agent', 'decide_approval', 'fetch_url',
      'create_objective', 'list_objectives', 'link_objective', 'create_key_result',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('exposes a read-only web.fetch capability for reading external URLs', () => {
    const caps = buildPlatformCapabilities(makeCtx().ctx);
    const web = caps.find((c) => c.domain === 'web' && c.method === 'fetch');
    expect(web).toBeTruthy();
    expect(web?.mutates).toBe(false);
    expect(web?.parameters).toMatchObject({ required: ['url'] });
  });

  it('does not collide with the IDE-owned action names', () => {
    const names = buildPlatformActions(makeCtx().ctx).map((a) => a.name);
    for (const ide of ['create_file', 'apply_code_to_active_file', 'generate_prd', 'generate_tasks', 'use_video_prompt', 'set_narration_text']) {
      expect(names).not.toContain(ide);
    }
  });

  it('every action has a name, description, object params, and run()', () => {
    for (const a of buildPlatformActions(makeCtx().ctx)) {
      expect(a.name).toMatch(/^[a-z_]+$/);
      expect(a.description).toBeTruthy();
      expect(a.parameters).toMatchObject({ type: 'object' });
      expect(typeof a.run).toBe('function');
    }
  });
});

describe('OKRs / PMO live in their own tables, not the task board', () => {
  it('exposes objective + key-result capabilities (the Portfolio ▸ OKRs surface)', () => {
    const caps = buildPlatformCapabilities(makeCtx().ctx);
    const has = (domain: string, method: string) => caps.some((c) => c.domain === domain && c.method === method);
    expect(has('objectives', 'create')).toBe(true);
    expect(has('objectives', 'list')).toBe(true);
    expect(has('objectives', 'add_link')).toBe(true);
    expect(has('key_results', 'create')).toBe(true);
    expect(has('portfolios', 'create')).toBe(true);
    expect(has('initiatives', 'create')).toBe(true);
    expect(has('pmo', 'tree')).toBe(true);
  });

  it('objectives.create requires a title and key_results.create needs an objectiveId', () => {
    const caps = buildPlatformCapabilities(makeCtx().ctx);
    const obj = caps.find((c) => c.domain === 'objectives' && c.method === 'create')!;
    const kr = caps.find((c) => c.domain === 'key_results' && c.method === 'create')!;
    expect(obj.mutates).toBe(true);
    expect(obj.parameters).toMatchObject({ required: ['title'] });
    expect(kr.parameters).toMatchObject({ required: ['objectiveId', 'title'] });
  });

  it('steers create_task away from modeling OKRs as Epics', () => {
    const create = actionByName('create_task')!;
    expect(create.description).toMatch(/not an okr/i);
    expect(create.description).toMatch(/objectives\.create/i);
  });

  it('promotes OKR tools when the Portfolio (/pmo) route is in focus', () => {
    expect(focusDomainsForPath('/pmo')).toContain('objectives');
    expect(focusDomainsForPath('/projects')).toContain('objectives');
  });
});

describe('navigate_to', () => {
  it('resolves a static page and calls navigate', async () => {
    const { ctx, navigate } = makeCtx();
    const nav = buildPlatformActions(ctx).find((a) => a.name === 'navigate_to')!;
    const res = await nav.run({ page: 'workflows' });
    expect(navigate).toHaveBeenCalledWith('/workflows');
    expect(res).toEqual({ navigated: '/workflows' });
  });

  it('resolves a dynamic page with an id (and appends a query)', async () => {
    const { ctx, navigate } = makeCtx();
    const nav = buildPlatformActions(ctx).find((a) => a.name === 'navigate_to')!;
    await nav.run({ page: 'ide_project', id: 42, query: 'chat=9' });
    expect(navigate).toHaveBeenCalledWith('/ide/42?chat=9');
  });

  it('resolves the project task board to the scoped Tasks tab (not the IDE redirect)', async () => {
    const { ctx, navigate } = makeCtx();
    const nav = buildPlatformActions(ctx).find((a) => a.name === 'navigate_to')!;
    await nav.run({ page: 'project_tasks', id: 14 });
    expect(navigate).toHaveBeenCalledWith('/projects?tab=tasks&project=14');
  });

  it('errors (without navigating) on a dynamic page missing its id', async () => {
    const { ctx, navigate } = makeCtx();
    const nav = buildPlatformActions(ctx).find((a) => a.name === 'navigate_to')!;
    const res = await nav.run({ page: 'project' });
    expect(res).toMatchObject({ error: expect.stringContaining('id') });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('errors on an unknown page', async () => {
    const { ctx, navigate } = makeCtx();
    const nav = buildPlatformActions(ctx).find((a) => a.name === 'navigate_to')!;
    const res = await nav.run({ page: 'does_not_exist' });
    expect(res).toMatchObject({ error: expect.stringContaining('Unknown page') });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('open_project', () => {
  it('navigates to the IDE for the project', async () => {
    const { ctx, navigate } = makeCtx();
    const open = buildPlatformActions(ctx).find((a) => a.name === 'open_project')!;
    const res = await open.run({ id: 5 });
    expect(navigate).toHaveBeenCalledWith('/ide/5');
    expect(res).toEqual({ opened: '/ide/5' });
  });
});

describe('dispatcher', () => {
  it('list_platform_capabilities returns domains + a filterable catalog', async () => {
    const list = actionByName('list_platform_capabilities')!;
    const all = (await list.run({})) as { domains: string[]; count: number; capabilities: unknown[] };
    expect(all.domains).toContain('tasks');
    expect(all.count).toBe(all.capabilities.length);

    const onlyTasks = (await list.run({ domain: 'tasks' })) as { capabilities: Array<{ domain: string }> };
    expect(onlyTasks.capabilities.every((c) => c.domain === 'tasks')).toBe(true);
  });

  it('call_platform_capability dispatches to the wrapped client method (slimmed)', async () => {
    const call = actionByName('call_platform_capability')!;
    const res = (await call.run({ domain: 'tasks', method: 'list', args: {} })) as Array<Record<string, unknown>>;
    expect(tasksApi.list).toHaveBeenCalledTimes(1);
    // tasks.list returns the SLIM projection — id/key/title present, no `description`.
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: 1, key: 'ACME-1', title: 'Fix login error', status: 'todo', archived: false });
    expect(res[0]).not.toHaveProperty('description');
  });

  it('returns a recoverable error for an unknown capability', async () => {
    const call = actionByName('call_platform_capability')!;
    const res = await call.run({ domain: 'nope', method: 'whatever', args: {} });
    expect(res).toMatchObject({ error: expect.stringContaining('Unknown capability') });
  });
});

describe('Tier-1 promotion reuses the manifest run()', () => {
  it('create_project calls the underlying API client', async () => {
    const create = actionByName('create_project')!;
    const res = await create.run({ name: 'Acme', modality: 'designer' });
    expect(api.createProject).toHaveBeenCalledWith({ name: 'Acme', modality: 'designer' });
    expect(res).toEqual({ id: 42, name: 'Acme' });
  });
});

describe('mutation flags (drive the HITL confirm gate)', () => {
  it('marks writes mutating and reads non-mutating', () => {
    const actions = buildPlatformActions(makeCtx().ctx);
    const byName = (n: string) => actions.find((a) => a.name === n)!;
    expect(byName('create_project').mutates).toBe(true);
    expect(byName('delete_project').mutates).toBe(true);
    expect(byName('decide_approval').mutates).toBe(true);
    expect(byName('list_projects').mutates).toBe(false);
    expect(byName('navigate_to').mutates).toBe(false);
    expect(byName('open_project').mutates).toBe(false);
    expect(byName('list_platform_capabilities').mutates).toBe(false);
  });

  it('the dispatcher gates per the targeted capability (predicate)', () => {
    const call = actionByName('call_platform_capability')!;
    expect(typeof call.mutates).toBe('function');
    const pred = call.mutates as (args: unknown) => boolean;
    expect(pred({ domain: 'tasks', method: 'create' })).toBe(true);
    expect(pred({ domain: 'tasks', method: 'list' })).toBe(false);
    expect(pred({ domain: 'nope', method: 'nope' })).toBe(false);
  });
});

describe('update actions whitelist the patch body (no blind-forward)', () => {
  it('drops the identifier + undeclared keys, keeps only declared fields the model set', async () => {
    const update = vi.fn().mockResolvedValue({ ok: true });
    const spy = vi.spyOn(integrationsApi, 'update').mockImplementation(update);
    try {
      const cap = buildPlatformCapabilities(makeCtx().ctx).find((c) => c.domain === 'integrations' && c.method === 'update')!;
      // The model (mis-grounded) sends the identifier, the intended field, an
      // undeclared/hallucinated key, AND a stray declared field it shouldn't.
      await cap.run({ id: 'int_1', baseUrl: 'https://new.example', hallucinated: 'x' });
      expect(spy).toHaveBeenCalledWith('int_1', { baseUrl: 'https://new.example' });
      const [, patch] = spy.mock.calls[0];
      expect(patch).not.toHaveProperty('id');
      expect(patch).not.toHaveProperty('hallucinated');
    } finally {
      spy.mockRestore();
    }
  });

  it('only forwards the fields actually present (true partial update)', async () => {
    const spy = vi.spyOn(integrationsApi, 'update').mockResolvedValue({ ok: true } as never);
    try {
      const cap = buildPlatformCapabilities(makeCtx().ctx).find((c) => c.domain === 'integrations' && c.method === 'update')!;
      await cap.run({ id: 'int_1', name: 'Renamed' });
      expect(spy).toHaveBeenCalledWith('int_1', { name: 'Renamed' });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('toSlimTask', () => {
  it('keeps the at-a-glance fields and drops the heavy body', () => {
    const slim = toSlimTask(FULL_TASK as never);
    expect(slim).toEqual({
      id: 1, projectId: 9, key: 'ACME-1', title: 'Fix login error', status: 'todo',
      priority: 'high', taskType: 'task', parentTaskId: null, sprintId: null,
      assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null,
      githubPrUrl: null, archived: false,
    });
    expect(slim).not.toHaveProperty('description');
  });
});

describe('context-aware focus promotion', () => {
  it('maps routes to relevant domains', () => {
    expect(focusDomainsForPath('/workflows')).toContain('workflows');
    expect(focusDomainsForPath('/prompts')).toEqual(['prompts']);
    expect(focusDomainsForPath('/projects/12')).toContain('tasks');
    expect(focusDomainsForPath('/marketing/blog')).toEqual([]);
    expect(focusDomainsForPath(null)).toEqual([]);
  });

  it('promotes the focused domain’s core methods first-class (deduped vs the static core)', () => {
    const navigate = vi.fn();
    const base = buildPlatformActions({ navigate, getTenantId: () => 7 }).map((a) => a.name);
    const focused = buildPlatformActions({ navigate, getTenantId: () => 7, focusDomains: ['prompts'] }).map((a) => a.name);
    expect(base).not.toContain('prompts_create');
    expect(focused).toContain('prompts_create');
    expect(focused).toContain('prompts_list');
    // No duplicate names introduced by promotion.
    expect(new Set(focused).size).toBe(focused.length);
  });

  it('does not double-promote a method already in the static core', () => {
    const navigate = vi.fn();
    // projects.create is statically promoted as create_project; focusing projects
    // must not also add a projects_create twin.
    const names = buildPlatformActions({ navigate, getTenantId: () => 7, focusDomains: ['projects'] }).map((a) => a.name);
    expect(names).not.toContain('projects_create');
    expect(names).toContain('create_project');
  });
});
