import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPlatformActions, type PlatformActionContext } from './platformActions';

// platformActions.ts is now CLIENT-ONLY navigation/UI actions — all data
// capabilities moved to the server MCP catalog (builtinMcpService.CATALOG,
// registered via McpExtensionsBridge). These tests cover the surviving actions.

function makeCtx() {
  const navigate = vi.fn();
  const ctx: PlatformActionContext = { navigate };
  return { ctx, navigate };
}

const actionByName = (name: string) => buildPlatformActions(makeCtx().ctx).find((a) => a.name === name);

beforeEach(() => vi.clearAllMocks());

describe('buildPlatformActions — client-only surface', () => {
  it('exposes ONLY the three client actions (data tools come from the server catalog)', () => {
    const names = buildPlatformActions(makeCtx().ctx).map((a) => a.name).sort();
    expect(names).toEqual(['navigate_to', 'open_migration_panel', 'open_project']);
  });

  it('does not re-declare any data capability (no dispatcher / promoted CRUD)', () => {
    const names = buildPlatformActions(makeCtx().ctx).map((a) => a.name);
    for (const gone of ['list_platform_capabilities', 'call_platform_capability', 'create_task', 'create_project', 'list_tasks']) {
      expect(names).not.toContain(gone);
    }
  });

  it('every action is well-formed (name, description, object params, run)', () => {
    for (const a of buildPlatformActions(makeCtx().ctx)) {
      expect(a.name).toMatch(/^[a-z_]+$/);
      expect(a.description).toBeTruthy();
      expect(a.parameters).toMatchObject({ type: 'object' });
      expect(typeof a.run).toBe('function');
      expect(a.mutates).toBe(false); // navigation never mutates data
    }
  });

  it('does not collide with the IDE-owned action names', () => {
    const names = buildPlatformActions(makeCtx().ctx).map((a) => a.name);
    for (const ide of ['create_file', 'apply_code_to_active_file', 'generate_prd', 'generate_tasks']) {
      expect(names).not.toContain(ide);
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

  it('carries a chat id into the IDE when given', async () => {
    const { ctx, navigate } = makeCtx();
    const open = buildPlatformActions(ctx).find((a) => a.name === 'open_project')!;
    await open.run({ id: 5, chatId: 9 });
    expect(navigate).toHaveBeenCalledWith('/ide/5?chat=9');
  });

  it('errors without a project id', async () => {
    const open = actionByName('open_project')!;
    const res = await open.run({});
    expect(res).toMatchObject({ error: expect.stringContaining('project id') });
  });
});

describe('open_migration_panel', () => {
  it('dispatches the open-panel window event with runId/provider', async () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    try {
      const open = actionByName('open_migration_panel')!;
      const res = await open.run({ provider: 'jira' });
      expect(spy).toHaveBeenCalledTimes(1);
      const evt = spy.mock.calls[0][0] as CustomEvent;
      expect(evt.type).toBe('builderforce:open-migration-panel');
      expect(evt.detail).toMatchObject({ provider: 'jira', runId: null });
      expect(res).toMatchObject({ opened: 'migration-panel', provider: 'jira' });
    } finally {
      spy.mockRestore();
    }
  });
});
