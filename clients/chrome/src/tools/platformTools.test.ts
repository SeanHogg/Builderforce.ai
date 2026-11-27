import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import type { RunCatalog } from '../host/rovrRunHost';
import { createPlatformCatalog, isPlatformTool, PLATFORM_CATALOG_TTL_MS, withPlatformTools } from './platformTools';
import { ADD_TASK_TOOL, BROWSER_TOOL } from './toolNames';

afterEach(() => vi.unstubAllGlobals());

const action = (name: string, mutates: boolean, result: unknown = { ok: name }): BrainAction => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {} },
  mutates,
  run: vi.fn(async () => result),
});

function browserCatalog(): RunCatalog & { run: ReturnType<typeof vi.fn> } {
  return {
    specs: [{ type: 'function', function: { name: BROWSER_TOOL.click, description: 'click', parameters: {} } }],
    run: vi.fn(async () => ({ clicked: true })),
    needsConfirm: (req) => req.name === BROWSER_TOOL.click,
  };
}

describe('withPlatformTools — the platform catalog beside the browser tools', () => {
  it('offers both, dispatches each to its own runner, and gates platform WRITES only', async () => {
    const read = action('builtin_tasks_list', false);
    const write = action('builtin_tasks_create', true);
    const browser = browserCatalog();
    const merged = withPlatformTools(browser, [read, write]);

    expect(merged.specs.map((s) => s.function.name)).toEqual([BROWSER_TOOL.click, 'builtin_tasks_list', 'builtin_tasks_create']);

    await merged.run('builtin_tasks_create', { title: 'x' });
    expect(write.run).toHaveBeenCalledWith({ title: 'x' });
    await merged.run(BROWSER_TOOL.click, { ref: 'e1' });
    expect(browser.run).toHaveBeenCalledWith(BROWSER_TOOL.click, { ref: 'e1' });

    expect(merged.needsConfirm({ name: 'builtin_tasks_create', args: {} })).toBe(true);
    expect(merged.needsConfirm({ name: 'builtin_tasks_list', args: {} })).toBe(false);
    expect(merged.needsConfirm({ name: BROWSER_TOOL.click, args: {} })).toBe(true);
  });

  it('leaves the browser catalog untouched when there are no platform tools', () => {
    const browser = browserCatalog();
    expect(withPlatformTools(browser, [])).toBe(browser);
  });

  it('asks for approval when a platform action has no declared effect', () => {
    const external = { ...action('external_send', false), mutates: undefined };
    const merged = withPlatformTools(browserCatalog(), [external]);
    expect(merged.needsConfirm({ name: external.name, args: {} })).toBe(true);
  });

  it('lets canonical platform actions keep a unique old alias without shadowing browser tools', async () => {
    const canonical = { ...action('platform__tasks_create', true), legacyName: 'builtin_tasks_create' };
    const browser = browserCatalog();
    const merged = withPlatformTools(browser, [
      canonical,
      { ...action('ext-one__x', true), legacyName: 'mcp_conflict' },
      { ...action('ext-two__x', true), legacyName: 'mcp_conflict' },
      { ...action('ext-three__x', true), legacyName: BROWSER_TOOL.click },
    ]);

    expect(merged.specs.map((s) => s.function.name)).toContain('platform__tasks_create');
    expect(merged.specs.map((s) => s.function.name)).not.toContain('builtin_tasks_create');
    expect(merged.needsConfirm({ name: canonical.legacyName, args: {} })).toBe(true);
    await merged.run(canonical.legacyName, { title: 'via old alias' });
    expect(canonical.run).toHaveBeenCalledWith({ title: 'via old alias' });
    await merged.run(BROWSER_TOOL.click, { ref: 'e1' });
    expect(browser.run).toHaveBeenCalledWith(BROWSER_TOOL.click, { ref: 'e1' });
    await merged.run('mcp_conflict', {});
    expect(browser.run).toHaveBeenCalledWith('mcp_conflict', {});
  });

  it("tells Rovr's own tools from platform ones", () => {
    expect(isPlatformTool(BROWSER_TOOL.navigate)).toBe(false);
    expect(isPlatformTool(ADD_TASK_TOOL)).toBe(false);
    expect(isPlatformTool('builtin_tickets_create')).toBe(true);
  });
});

describe('createPlatformCatalog', () => {
  it('fetches the canonical REST catalog in the production loader', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ tools: [{
      extensionId: 'builtin', tool: 'tasks.list', name: 'platform__tasks_list',
      legacyName: 'builtin_tasks_list', description: 'List', parameters: { type: 'object' }, mutates: false,
    }] })));
    vi.stubGlobal('fetch', fetcher);
    const catalog = createPlatformCatalog({ baseUrl: 'https://gw', key: async () => 'fixture' });
    expect(await catalog.actions()).toMatchObject([{ name: 'platform__tasks_list', legacyName: 'builtin_tasks_list' }]);
    expect(fetcher).toHaveBeenCalledWith('https://gw/llm/v1/mcp/tools?names=canonical', expect.anything());
  });

  it('offers nothing signed out, and never reads the catalog', async () => {
    const load = vi.fn(async () => [action('builtin_tasks_list', false)]);
    const catalog = createPlatformCatalog({ baseUrl: 'https://gw', key: async () => null, load });
    expect(await catalog.actions()).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it('reads once per TTL with the signed-in key, and drops names a Rovr tool holds', async () => {
    let clock = 0;
    const load = vi.fn(async (transport: { baseUrl: string; getToken: () => string | null }) => {
      expect(transport).toMatchObject({ baseUrl: 'https://gw' });
      expect(transport.getToken()).toBe('bfk_1');
      return [action(BROWSER_TOOL.click, true), action('builtin_tasks_list', false)];
    });
    const catalog = createPlatformCatalog({ baseUrl: 'https://gw', key: async () => 'bfk_1', load, now: () => clock });

    expect((await catalog.actions()).map((a) => a.name)).toEqual(['builtin_tasks_list']);
    clock = PLATFORM_CATALOG_TTL_MS - 1;
    await catalog.actions();
    expect(load).toHaveBeenCalledTimes(1);
    clock = PLATFORM_CATALOG_TTL_MS;
    await catalog.actions();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('degrades to the browser tools on a failed read, reports it, and retries next run', async () => {
    const onError = vi.fn();
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('tool catalog unavailable (HTTP 503)'))
      .mockResolvedValueOnce([action('builtin_tasks_list', false)]);
    const catalog = createPlatformCatalog({ baseUrl: 'https://gw', key: async () => 'bfk_1', load, now: () => 0, onError });

    expect(await catalog.actions()).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((await catalog.actions()).map((a) => a.name)).toEqual(['builtin_tasks_list']);
  });
});
