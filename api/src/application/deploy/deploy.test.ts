import { describe, it, expect } from 'vitest';
import { deploy } from './index';
import { evaluatePolicyGate, lowerAgentSpec, type AgentSpec } from '@builderforce/agent-tools';

const base: AgentSpec = {
  identity: { name: 'Support Bot', title: 'Support', bio: 'Helps customers.' },
  model: { ref: 'builderforce/workforce-42' },
};

describe('deploy() registry', () => {
  it('resolves engine + transport + lowered run input for a cloud surface', () => {
    const plan = deploy(base, 'cloud-durable');
    expect(plan.surface).toBe('cloud-durable');
    expect(plan.engineId).toBe('builderforce-v2');
    expect(plan.transport).toBe('cloud-durable');
    expect(plan.runInput.systemPrompt).toContain('Support Bot');
    expect(plan.runInput.model).toBe('builderforce/workforce-42');
    expect(plan.cloudDispatchable).toBe(true);
  });

  it('maps each surface to its transport', () => {
    expect(deploy(base, 'workflow-node').transport).toBe('workflow-claim');
    expect(deploy(base, 'ide').transport).toBe('ide-bridge');
    expect(deploy(base, 'desktop').transport).toBe('desktop-bridge');
    expect(deploy(base, 'ide').cloudDispatchable).toBe(false);
  });

  it('honours an engine override (e.g. V3/limbic)', () => {
    expect(deploy(base, 'cloud-durable', { engineId: 'builderforce-v3' }).engineId).toBe('builderforce-v3');
  });

  it('rejects a surface the spec does not allow', () => {
    const restricted: AgentSpec = { ...base, surfaces: ['cloud-durable'] };
    expect(() => deploy(restricted, 'ide')).toThrow(/not allowed/);
    expect(deploy(restricted, 'cloud-durable').surface).toBe('cloud-durable');
  });
});

describe('policy gates reach the run input + enforce at the tool seam', () => {
  const spec: AgentSpec = {
    ...base,
    policy: {
      gates: [
        { id: 'g1', effect: 'inject-directive', directive: 'Always cite a source.' },
        { id: 'g2', effect: 'block', tool: 'shell', reason: 'no shell in prod' },
        { id: 'g3', effect: 'require-approval', tool: 'issue_refund' },
      ],
    },
  };

  it('renders governance gates into the lowered system prompt (every surface)', () => {
    const sp = lowerAgentSpec(spec).systemPrompt;
    expect(sp).toContain('Governance');
    expect(sp).toContain('Always cite a source.');
    expect(sp).toContain('shell');
  });

  it('evaluatePolicyGate blocks, gates, and allows correctly', () => {
    expect(evaluatePolicyGate(spec.policy!.gates, 'shell').action).toBe('block');
    expect(evaluatePolicyGate(spec.policy!.gates, 'issue_refund').action).toBe('require-approval');
    expect(evaluatePolicyGate(spec.policy!.gates, 'read_file').action).toBe('allow');
  });

  it('block wins over require-approval when both match', () => {
    const gates = [
      { id: 'a', effect: 'require-approval' as const, tool: 'x' },
      { id: 'b', effect: 'block' as const, tool: 'x' },
    ];
    expect(evaluatePolicyGate(gates, 'x').action).toBe('block');
  });
});
