/**
 * cloudCascadePorts — the cloud's couplings for D1/D2 (PRD 35 WS3). The cascade's own cases live with the agent
 * (`packages/agent-run/test/guards`); what the cloud owns is that a verdict becomes a training row for ITS execution,
 * through the difficulty router, and that reasoning escalates along the cloud's ladder.
 */
import { describe, expect, it, vi } from 'vitest';

const g = vi.hoisted(() => ({
  skip: vi.fn(async (..._a: unknown[]) => false),
  outcome: vi.fn(async (..._a: unknown[]) => undefined),
  rate: vi.fn(async (..._a: unknown[]): Promise<number | null> => 0.7),
}));
vi.mock('../llm/difficultyGate', () => ({ shouldSkipWeakAttempt: g.skip, recordCascadeOutcome: g.outcome, weakPassRate: g.rate }));
vi.mock('../llm/gatewaySummarizer', () => ({ buildGatewaySummarizer: () => async () => null }));

import { cloudCascadePorts } from './cloudAdapterHooks';

const ladder = { candidates: ['weak', 'mid'], rankOf: (m: string) => (m === 'weak' ? 0 : 1) };
const ports = (execParams?: { thinkLevel?: never }) => cloudCascadePorts({ env: {} as never, db: { tag: 'db' } as never, run: { tenantId: 7, projectId: 1, taskId: 2, executionId: 77, agentLabel: 'A' }, runRole: 'code', ladder, ...(execParams ? { execParams } : {}) });
const features = { actionType: 'bugfix', role: 'code', promptTokens: 10, toolCount: 3, turnIndex: 0 };

describe('cloudCascadePorts', () => {
  it('records a verdict as a training row stamped with the tenant, the execution and the role', async () => {
    await ports().recordOutcome!({ actionType: 'bugfix', weakModel: 'weak', passed: false, verifier: 'changed_files', features });
    expect(g.outcome).toHaveBeenCalledWith({}, { tag: 'db' }, expect.objectContaining({ tenantId: 7, executionId: '77', role: 'code', weakModel: 'weak', passed: false, verifier: 'changed_files' }));
  });

  it('asks the difficulty router per tenant, and reads the weak-pass prior for the action type', async () => {
    await ports().shouldSkipWeakAttempt!(features);
    expect(g.skip).toHaveBeenCalledWith({}, 7, features);
    expect(await ports().weakPassRate!('bugfix')).toBe(0.7);
    g.rate.mockResolvedValueOnce(null);
    expect(await ports().weakPassRate!('bugfix')).toBeUndefined();
  });

  it('escalates reasoning along the cloud\'s ladder, from the role default when the persona set none', () => {
    const p = ports();
    expect(p.defaultThinkLevel).toBe('medium');
    expect(p.escalateThinkLevel!('medium')).toBe('high');
    expect(ports({ thinkLevel: 'low' as never }).defaultThinkLevel).toBe('low');
  });
});
