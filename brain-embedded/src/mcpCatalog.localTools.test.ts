import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpActionsFrom, type McpToolEntry } from './mcpCatalog';

const transport = { baseUrl: 'https://api.test', getToken: () => 'tok' };
const entry = (tool: string): McpToolEntry => ({
  extensionId: 'builtin', tool, name: `builtin_${tool.replace('.', '_')}`, description: 'd', parameters: {}, mutates: false,
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('mcpActionsFrom — host-routed tools', () => {
  it('runs a tool the host claims through the host, never the relay', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const local = vi.fn(async () => ({ ok: true, target: 'browser' }));
    const results: boolean[] = [];
    const [action] = mcpActionsFrom([entry('runtime.preview_status')], transport, (info) => results.push(info.ok),
      (e) => (e.tool.startsWith('runtime.') ? local : undefined));
    expect(await action!.run({ projectId: 7 })).toEqual({ ok: true, target: 'browser' });
    expect(local).toHaveBeenCalledWith({ projectId: 7 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(results).toEqual([true]);
  });

  it('relays every tool the host does not claim', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ result: { ok: true } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const [action] = mcpActionsFrom([entry('tasks.list')], transport, undefined, () => undefined);
    expect(await action!.run({})).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith('https://api.test/llm/v1/mcp/call', expect.objectContaining({ method: 'POST' }));
  });

  it('collapses duplicate creates only inside the same authenticated relay scope', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify({
      result: { tenant: new Headers(init?.headers).get('Authorization')?.endsWith('fixture-a') ? 'a' : 'b' },
    })));
    vi.stubGlobal('fetch', fetchSpy);
    const tool = { ...entry('tasks.create'), mutates: true };
    let token = 'fixture-a';
    const [action] = mcpActionsFrom([tool], { ...transport, getToken: () => token });
    const args = { title: 'Identical task details' };

    expect(await action!.run(args)).toEqual({ tenant: 'a' });
    expect(await action!.run(args)).toEqual({ tenant: 'a' });
    token = 'fixture-b';
    expect(await action!.run(args)).toEqual({ tenant: 'b' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
