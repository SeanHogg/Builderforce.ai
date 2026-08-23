import { describe, expect, it, vi } from 'vitest';
import { callRemoteTool, listRemoteTools, McpAuthChallenge } from './mcpWireClient';

interface Call {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function makeFetch(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = { url, method: init?.method, headers: init?.headers as Record<string, string>, body: init?.body as string };
    calls.push(call);
    return handler(call);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const rpcOf = (body?: string): Record<string, unknown> => JSON.parse(body ?? '{}');

describe('listRemoteTools — real MCP transport', () => {
  it('speaks initialize → notifications/initialized → tools/list and paginates via nextCursor', async () => {
    const { fn, calls } = makeFetch((call) => {
      const rpc = rpcOf(call.body);
      if (rpc.method === 'tools/list') {
        const cursor = (rpc.params as { cursor?: string } | undefined)?.cursor;
        if (!cursor) {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'a', description: 'A' }], nextCursor: 'p2' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'b', description: 'B' }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: {} }), { status: 200 });
    });

    const { tools, protocol } = await listRemoteTools({ serverUrl: 'https://mcp.example', authorization: null, protocol: 'mcp', fetchImpl: fn });
    expect(protocol).toBe('mcp');
    expect(tools.map((t) => t.name)).toEqual(['a', 'b']);
    expect(calls.map((c) => rpcOf(c.body).method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list']);
  });

  it('reads a readOnlyHint annotation into the descriptor', async () => {
    const { fn } = makeFetch((call) => {
      const rpc = rpcOf(call.body);
      if (rpc.method === 'tools/list') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0', id: rpc.id,
          result: { tools: [{ name: 'read_it', description: 'x', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: {} }), { status: 200 });
    });
    const { tools } = await listRemoteTools({ serverUrl: 'https://mcp.example', authorization: null, protocol: 'mcp', fetchImpl: fn });
    expect(tools[0]?.readOnlyHint).toBe(true);
  });

  it('accepts an SSE-framed JSON-RPC response', async () => {
    const { fn } = makeFetch((call) => {
      const rpc = rpcOf(call.body);
      if (rpc.method === 'tools/list') {
        const sse = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'sse_tool', description: 'x' }] } })}\n\n`;
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: {} }), { status: 200 });
    });
    const { tools } = await listRemoteTools({ serverUrl: 'https://mcp.example', authorization: null, protocol: 'mcp', fetchImpl: fn });
    expect(tools.map((t) => t.name)).toEqual(['sse_tool']);
  });

  it('throws McpAuthChallenge on 401, carrying the WWW-Authenticate header, and does NOT fall back', async () => {
    const { fn, calls } = makeFetch(() => new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"' } }));
    await expect(listRemoteTools({ serverUrl: 'https://mcp.example', authorization: null, protocol: 'auto', fetchImpl: fn })).rejects.toBeInstanceOf(McpAuthChallenge);
    // Exactly one attempt (the MCP leg) — a 401 must not fall through to the legacy transport.
    expect(calls).toHaveLength(1);
  });

  it("'auto' falls back to the legacy REST pair when the MCP leg is not JSON-RPC", async () => {
    const { fn, calls } = makeFetch((call) =>
      call.url.endsWith('/tools')
        ? new Response(JSON.stringify({ tools: [{ name: 'legacy_tool', description: 'x', parameters: { type: 'object' } }] }), { status: 200 })
        : new Response('nope', { status: 404 }),
    );
    const { tools, protocol } = await listRemoteTools({ serverUrl: 'https://old.example', authorization: null, protocol: 'auto', fetchImpl: fn });
    expect(protocol).toBe('legacy');
    expect(tools.map((t) => t.name)).toEqual(['legacy_tool']);
    expect(calls[0]?.url).toBe('https://old.example'); // the failed MCP attempt first
    expect(calls[1]?.url).toBe('https://old.example/tools');
  });

  it("protocol: 'legacy' never attempts the MCP leg", async () => {
    const { fn, calls } = makeFetch((call) =>
      call.url.endsWith('/tools')
        ? new Response(JSON.stringify({ tools: [] }), { status: 200 })
        : new Response('should not be called', { status: 500 }),
    );
    await listRemoteTools({ serverUrl: 'https://old.example', authorization: null, protocol: 'legacy', fetchImpl: fn });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://old.example/tools');
  });
});

describe('callRemoteTool', () => {
  it('reads content blocks and honours isError as a recoverable result, not a throw', async () => {
    const { fn } = makeFetch((call) => {
      const rpc = rpcOf(call.body);
      if (rpc.method === 'tools/call') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: 'nope' }], isError: true } }), { status: 200 });
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: {} }), { status: 200 });
    });
    const { result } = await callRemoteTool({ serverUrl: 'https://mcp.example', authorization: null, protocol: 'mcp', fetchImpl: fn }, 'do_it', {});
    expect(result).toEqual({ error: 'nope' });
  });

  it('prefers structuredContent when present', async () => {
    const { fn } = makeFetch((call) => {
      const rpc = rpcOf(call.body);
      if (rpc.method === 'tools/call') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: '{}' }], structuredContent: { ok: true } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: {} }), { status: 200 });
    });
    const { result } = await callRemoteTool({ serverUrl: 'https://mcp.example', authorization: null, protocol: 'mcp', fetchImpl: fn }, 'do_it', {});
    expect(result).toEqual({ ok: true });
  });

  it('sends the Authorization header when one is supplied', async () => {
    const { fn, calls } = makeFetch((call) => {
      const rpc = rpcOf(call.body);
      if (rpc.method === 'tools/call') return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [] } }), { status: 200 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: {} }), { status: 200 });
    });
    await callRemoteTool({ serverUrl: 'https://mcp.example', authorization: 'Bearer tok123', protocol: 'mcp', fetchImpl: fn }, 'do_it', {});
    expect(calls.every((c) => c.headers?.Authorization === 'Bearer tok123')).toBe(true);
  });
});
