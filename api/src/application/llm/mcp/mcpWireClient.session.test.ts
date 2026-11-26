import { describe, expect, it } from 'vitest';
import { callRemoteTool, listRemoteTools } from './mcpWireClient';

function fakeServer() {
  const requests: Array<{ method: string; session: string | null; version: string | null }> = [];
  let sessionNumber = 0;
  let liveSession = '';
  const fetchImpl: typeof fetch = async (_url, options) => {
    const request = JSON.parse(String(options?.body));
    const headers = new Headers(options?.headers);
    const session = headers.get('Mcp-Session-Id');
    requests.push({ method: request.method, session, version: headers.get('MCP-Protocol-Version') });

    function reply(result: unknown, replyHeaders?: HeadersInit) {
      return Response.json({ jsonrpc: '2.0', id: request.id, result }, { headers: replyHeaders });
    }

    if (request.method === 'initialize') {
      liveSession = `session-${++sessionNumber}`;
      return reply({
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'test', version: '1' },
      }, { 'Mcp-Session-Id': liveSession });
    }
    if (session !== liveSession) return new Response(null, { status: 404 });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (request.method === 'tools/list') return reply({ tools: [{ name: 'record', inputSchema: { type: 'object' } }] });
    return reply({ content: [{ type: 'text', text: 'recorded' }] });
  };
  return { requests, fetchImpl, expire: () => { liveSession = ''; } };
}

describe('MCP session reuse', () => {
  it('shares negotiation across listing and dispatch, scoped to the tenant and credential', async () => {
    const server = fakeServer();
    const connection = {
      serverUrl: 'https://mcp.example',
      authorization: 'Bearer first',
      protocol: 'mcp' as const,
      sessionScope: 'tenant-a:extension',
      fetchImpl: server.fetchImpl,
    };
    await listRemoteTools(connection);
    await expect(callRemoteTool(connection, 'record', {})).resolves.toMatchObject({ result: 'recorded' });
    expect(server.requests.map((request) => request.method)).toEqual([
      'initialize', 'notifications/initialized', 'tools/list', 'tools/call',
    ]);
    expect(server.requests.slice(1)).toEqual([
      { method: 'notifications/initialized', session: 'session-1', version: '2025-03-26' },
      { method: 'tools/list', session: 'session-1', version: '2025-03-26' },
      { method: 'tools/call', session: 'session-1', version: '2025-03-26' },
    ]);
    await listRemoteTools({ ...connection, authorization: 'Bearer rotated' });
    await listRemoteTools({ ...connection, sessionScope: 'tenant-b:extension' });
    expect(server.requests.filter((request) => request.method === 'initialize')).toHaveLength(3);
  });

  it('reopens a stale session for discovery without replaying tool calls', async () => {
    const server = fakeServer();
    const connection = {
      serverUrl: 'https://mcp.example',
      authorization: null,
      protocol: 'mcp' as const,
      sessionScope: 'tenant:stale-session',
      fetchImpl: server.fetchImpl,
    };
    await listRemoteTools(connection);
    server.expire();
    await listRemoteTools(connection);
    expect(server.requests.filter((request) => request.method === 'initialize')).toHaveLength(2);

    server.expire();
    await expect(callRemoteTool(connection, 'record', {})).rejects.toThrow();
    expect(server.requests.filter((request) => request.method === 'tools/call')).toHaveLength(1);
    expect(server.requests.filter((request) => request.method === 'initialize')).toHaveLength(2);
  });
});
