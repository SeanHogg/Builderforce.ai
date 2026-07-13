import { describe, it, expect } from 'vitest';
import { coercePolicyGates } from '@builderforce/agent-tools';
import { parsePolicyGates } from '../runtime/cloudDispatch';
import { deployAndDispatch, type CloudRunDispatcher } from './dispatch';
import type { Db } from '../../infrastructure/database/connection';
import type { AgentSpec } from '@builderforce/agent-tools';

describe('coercePolicyGates / parsePolicyGates', () => {
  it('keeps only well-formed gates', () => {
    const gates = coercePolicyGates([
      { id: 'g1', effect: 'block', tool: 'shell', reason: 'no shell' },
      { id: 'g2', effect: 'inject-directive', directive: 'cite sources' },
      { effect: 'block' }, // no id → dropped
      { id: 'g3', effect: 'nonsense' }, // bad effect → dropped
      'garbage',
    ]);
    expect(gates.map((g) => g.id)).toEqual(['g1', 'g2']);
  });

  it('parsePolicyGates reads gates off a payload string; [] on garbage', () => {
    expect(parsePolicyGates(JSON.stringify({ policyGates: [{ id: 'g1', effect: 'block' }] }))).toHaveLength(1);
    expect(parsePolicyGates('not json')).toEqual([]);
    expect(parsePolicyGates(undefined)).toEqual([]);
    expect(parsePolicyGates(JSON.stringify({ model: 'x' }))).toEqual([]);
  });
});

const cloudSpec: AgentSpec = {
  identity: { name: 'Support Bot' },
  model: { ref: 'builderforce/workforce-1' },
  policy: { gates: [{ id: 'g1', effect: 'block', tool: 'shell' }] },
  surfaces: ['cloud-durable'],
};

describe('deployAndDispatch', () => {
  const fakeDb = {} as Db;

  it('dispatches a cloud run carrying the spec gates + model in the payload', async () => {
    let seen: { taskId: number; payload?: string } | null = null;
    const dispatchCloudRun: CloudRunDispatcher = async (p) => {
      seen = { taskId: p.taskId, payload: p.payload };
      return 4242;
    };
    const res = await deployAndDispatch(cloudSpec, 'cloud-durable', {
      db: fakeDb, tenantId: 7, taskId: 99, cloudAgentRef: 'agent:1', dispatchCloudRun,
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.kind === 'cloud') expect(res.executionId).toBe(4242);
    else throw new Error('expected cloud dispatch');
    expect(seen!.taskId).toBe(99);
    const payload = JSON.parse(seen!.payload!) as { policyGates?: unknown[]; model?: string; cloudAgentRef?: string };
    expect(payload.policyGates).toHaveLength(1);
    expect(payload.model).toBe('builderforce/workforce-1');
    expect(payload.cloudAgentRef).toBe('agent:1');
  });

  it('returns plan-only for a cloud surface with no task/dispatcher', async () => {
    const res = await deployAndDispatch(cloudSpec, 'cloud-durable', { db: fakeDb, tenantId: 7 });
    expect(res.ok && res.kind).toBe('plan-only');
  });

  it('returns plan-only for IDE (client-driven surface)', async () => {
    const spec: AgentSpec = { ...cloudSpec, surfaces: ['ide'] };
    const res = await deployAndDispatch(spec, 'ide', { db: fakeDb, tenantId: 7 });
    expect(res.ok && res.kind).toBe('plan-only');
    if (res.ok && res.kind === 'plan-only') expect(res.reason).toMatch(/client relay/);
  });

  it('rejects a surface the spec does not allow', async () => {
    const res = await deployAndDispatch(cloudSpec, 'ide', { db: fakeDb, tenantId: 7 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not allowed/);
  });

  it('plan-only when a workflow surface spec has no steps', async () => {
    const spec: AgentSpec = { identity: { name: 'x' }, surfaces: ['workflow-node'] };
    const res = await deployAndDispatch(spec, 'workflow-node', { db: fakeDb, tenantId: 7 });
    expect(res.ok && res.kind).toBe('plan-only');
  });
});
