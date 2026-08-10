import { describe, expect, it, vi } from 'vitest';

import { AgentHostRelayDO } from './AgentHostRelayDO';

/**
 * Egress correlation.
 *
 * Every other route on this relay is fire-and-forget — put a frame on the wire, return.
 * Egress is the one REQUEST: a vendor module is blocked on a real `Response`, so the DO
 * has to hold the HTTP request open and match the reply frame to it. The states that
 * matter are the ones where a caller could be stranded (host offline, host disconnects
 * mid-flight) and the one where a reply could leak (an egress response carries the
 * provider's body and must never reach browser clients).
 */

/** Minimal WebSocket double: records sends, lets a test push frames back. */
function fakeSocket() {
  const sent: string[] = [];
  const listeners: Record<string, Array<(ev: { data?: string }) => void>> = {};
  const ws = {
    readyState: 1, // WebSocket.OPEN
    accept: () => {},
    send: (data: string) => { sent.push(data); },
    close: () => {},
    addEventListener: (type: string, fn: (ev: { data?: string }) => void) => {
      (listeners[type] ??= []).push(fn);
    },
  };
  return {
    ws: ws as unknown as WebSocket,
    sent,
    emit: (type: string, ev: { data?: string } = {}) => {
      for (const fn of listeners[type] ?? []) fn(ev);
    },
  };
}

/** A DO with an attached upstream host, plus the client socket that would receive
 *  broadcasts. `attachUpstream`/`attachClient` are private, so drive them the way the
 *  Worker does — through `fetch` with a websocket upgrade. */
function relayWithHost() {
  const state = { waitUntil: () => {} } as unknown as DurableObjectState;
  const relay = new AgentHostRelayDO(state, {});
  const upstream = fakeSocket();
  const client = fakeSocket();
  // Bypass the WebSocketPair the real upgrade path constructs (unavailable outside
  // workerd) and attach the doubles directly.
  (relay as unknown as { attachUpstream(ws: WebSocket): void }).attachUpstream(upstream.ws);
  (relay as unknown as { attachClient(ws: WebSocket): void }).attachClient(client.ws);
  return { relay, upstream, client };
}

const egressRequest = (body: Record<string, unknown>) =>
  new Request('https://relay.internal/host-egress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Let the DO's handler get past `await request.json()` and register its waiter.
 *  Without this every "reply arrives" test races the request it is replying to. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AgentHostRelayDO — host egress', () => {
  it('sends the request upstream and resolves with the host reply', async () => {
    const { relay, upstream } = relayWithHost();

    const pending = relay.fetch(egressRequest({
      requestId: 'req-1',
      url: 'https://api.kimi.com/coding/v1/chat/completions',
      body: '{"model":"kimi-for-coding"}',
    }));
    await settle();

    // The frame reached the host, tagged so the reply can be matched back.
    const frame = JSON.parse(upstream.sent.at(-1)!) as Record<string, unknown>;
    expect(frame).toMatchObject({ type: 'host.egress.request', requestId: 'req-1' });

    upstream.emit('message', {
      data: JSON.stringify({
        type: 'host.egress.response',
        requestId: 'req-1',
        response: { status: 200, headers: {}, body: '{"ok":true}' },
      }),
    });

    const res = await pending;
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, response: { status: 200, body: '{"ok":true}' } });
  });

  it('never broadcasts an egress reply to browser clients', async () => {
    // The reply carries the provider's response body. Browser clients are watching a
    // chat transcript; this is not theirs to see.
    const { relay, upstream, client } = relayWithHost();
    const before = client.sent.length;

    const pending = relay.fetch(egressRequest({ requestId: 'req-2', url: 'https://api.kimi.com/x' }));
    await settle();
    upstream.emit('message', {
      data: JSON.stringify({
        type: 'host.egress.response',
        requestId: 'req-2',
        response: { status: 200, headers: {}, body: 'SENSITIVE' },
      }),
    });
    await pending;

    expect(client.sent.slice(before).join('')).not.toContain('SENSITIVE');
  });

  it('still forwards ordinary host traffic to clients', async () => {
    // The egress interception must claim ONLY its own frames.
    const { upstream, client } = relayWithHost();
    const before = client.sent.length;
    upstream.emit('message', {
      data: JSON.stringify({ type: 'chat.message', role: 'assistant', text: 'hello' }),
    });
    expect(client.sent.slice(before).join('')).toContain('hello');
  });

  it('answers 409 immediately when no host is connected', async () => {
    // The caller must fall back to direct egress now, not sit on a request nothing
    // will ever answer.
    const state = { waitUntil: () => {} } as unknown as DurableObjectState;
    const relay = new AgentHostRelayDO(state, {});
    const res = await relay.fetch(egressRequest({ requestId: 'req-3', url: 'https://api.kimi.com/x' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'agent_host_offline' });
  });

  it('releases in-flight callers when the host disconnects', async () => {
    // Otherwise every one of them waits out the full 120s ceiling for a socket that is
    // already gone. Reported as `agent_host_offline` / 409 — the same answer a caller
    // gets when no host was connected in the first place, because it is the same fact
    // and the same fallback (go direct).
    const { relay, upstream } = relayWithHost();
    const pending = relay.fetch(egressRequest({ requestId: 'req-4', url: 'https://api.kimi.com/x' }));
    await settle();

    (upstream.ws as { readyState: number }).readyState = 3; // CLOSED
    upstream.emit('close');

    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: 'agent_host_offline' });
  });

  it('reports a host-side failure as a failure, not an empty success', async () => {
    // The runtime refuses a destination that is not allowlisted. If that came back
    // `ok: true` with a null response, the vendor layer would be left interpreting an
    // absent payload as if the provider had answered.
    const { relay, upstream } = relayWithHost();
    const pending = relay.fetch(egressRequest({ requestId: 'req-6', url: 'https://api.kimi.com/x' }));
    await settle();
    upstream.emit('message', {
      data: JSON.stringify({
        type: 'host.egress.response',
        requestId: 'req-6',
        error: 'host not allowed: evil.test',
      }),
    });

    const res = await pending;
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: 'host not allowed: evil.test' });
  });

  it('ignores a reply whose request id nobody is waiting on', async () => {
    const { upstream, client } = relayWithHost();
    const before = client.sent.length;
    // A late reply after its waiter timed out: consumed, never broadcast, no throw.
    expect(() => upstream.emit('message', {
      data: JSON.stringify({ type: 'host.egress.response', requestId: 'gone', response: { status: 200, headers: {}, body: 'x' } }),
    })).not.toThrow();
    expect(client.sent.slice(before)).toEqual([]);
  });

  it('rejects a malformed body without touching the socket', async () => {
    const { relay, upstream } = relayWithHost();
    const before = upstream.sent.length;
    const res = await relay.fetch(new Request('https://relay.internal/host-egress', {
      method: 'POST', body: 'not json',
    }));
    expect(res.status).toBe(400);
    expect(upstream.sent.length).toBe(before);
  });
});
