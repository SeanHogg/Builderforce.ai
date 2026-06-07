import { describe, it, expect, vi, beforeEach } from 'vitest';

// Override only the two methods the dispatch/promotion tests exercise; the rest
// of the real client imports cleanly (no network at import time).
vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>();
  return { ...mod, createProject: vi.fn().mockResolvedValue({ id: 42, name: 'Acme' }) };
});
vi.mock('@/lib/builderforceApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/builderforceApi')>();
  return { ...mod, tasksApi: { ...mod.tasksApi, list: vi.fn().mockResolvedValue([{ id: 1 }]) } };
});

import { buildPlatformActions, buildPlatformCapabilities, focusDomainsForPath, type PlatformActionContext } from './platformActions';
import * as api from '@/lib/api';
import { tasksApi } from '@/lib/builderforceApi';

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
      'hire_agent', 'create_cloud_agent', 'decide_approval',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('does not collide with the IDE-owned action names', () => {
    const names = buildPlatformActions(makeCtx().ctx).map((a) => a.name);
    for (const ide of ['create_file', 'apply_code_to_active_file', 'generate_prd', 'generate_tasks', 'use_video_prompt']) {
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

  it('call_platform_capability dispatches to the wrapped client method', async () => {
    const call = actionByName('call_platform_capability')!;
    const res = await call.run({ domain: 'tasks', method: 'list', args: {} });
    expect(tasksApi.list).toHaveBeenCalledTimes(1);
    expect(res).toEqual([{ id: 1 }]);
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
