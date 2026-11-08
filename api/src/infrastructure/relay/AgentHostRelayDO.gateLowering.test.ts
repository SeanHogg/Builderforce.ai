import { describe, expect, it } from 'vitest';
import type { PolicyGate } from '@builderforce/agent-tools';

import { AgentHostRelayDO } from './AgentHostRelayDO';

/**
 * Governance class gates at the host relay: the relay is where a frame is SENT to a host, so it is where a host that predates
 * `sideEffect` gates is handed them spelled out per tool. A host that declared the wire level on its upstream link gets the
 * compact form; nothing upstream of the relay (the cloud runner included) ever sees the lowered one.
 */

function relayWithHost(gatesLevel: string | null) {
  const state = { waitUntil: () => {} } as unknown as DurableObjectState;
  const relay = new AgentHostRelayDO(state, {});
  const sent: string[] = [];
  const ws = { readyState: 1, accept: () => {}, send: (d: string) => { sent.push(d); }, close: () => {}, addEventListener: () => {} };
  (relay as unknown as { attachUpstream(ws: WebSocket): void }).attachUpstream(ws as unknown as WebSocket);
  (relay as unknown as { hostGatesLevel: string | null }).hostGatesLevel = gatesLevel;
  return { relay, sent };
}

const GATE: PolicyGate = { id: 'p1:ro', sideEffect: 'mutate', effect: 'block', reason: 'read-only run' };

const assign = () => new Request('https://relay.internal/dispatch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'task.assign', executionId: 1, taskId: 2, task: { title: 't', description: null },
    payload: JSON.stringify({ model: 'm', policyGates: [GATE] }),
  }),
});

const gatesSent = (sent: string[]): PolicyGate[] =>
  (JSON.parse(JSON.parse(sent.at(-1)!).payload) as { policyGates: PolicyGate[] }).policyGates;

describe('AgentHostRelayDO /dispatch — class gate lowering', () => {
  it('spells a class gate out per tool for a host that did not declare the wire level', async () => {
    const { relay, sent } = relayWithHost(null);

    expect((await relay.fetch(assign())).status).toBe(200);

    const gates = gatesSent(sent);
    expect(gates.length).toBeGreaterThan(1);
    expect(gates.every((g) => g.sideEffect === undefined && typeof g.tool === 'string' && g.baseGateId === 'p1:ro')).toBe(true);
  });

  it('sends the compact form to a host that declared the wire level', async () => {
    const { relay, sent } = relayWithHost('2');

    await relay.fetch(assign());

    expect(gatesSent(sent)).toEqual([GATE]);
  });
});
