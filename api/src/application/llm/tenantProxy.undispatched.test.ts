import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordAvoidedCall, recordServedWithoutModel } = vi.hoisted(() => ({
  recordAvoidedCall: vi.fn(async () => undefined),
  recordServedWithoutModel: vi.fn(async () => undefined),
}));
vi.mock('./savingsLedger', () => ({ recordAvoidedCall, recordServedWithoutModel }));
vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: () => ({}) }));

import { recordUndispatchedAnswer } from './tenantProxy';
import type { ProxyResult } from './proxyTypes';

const env = {} as never;
const who = { tenantId: 4, userId: 'u', projectId: 9 };
const result = (over: Partial<ProxyResult>) => ({ resolvedModel: 'm', ...over }) as ProxyResult;

beforeEach(() => vi.clearAllMocks());

describe('recordUndispatchedAnswer — every answer served without a model is counted', () => {
  it('records a replayed cache hit as the call it saved, priced from its upstream usage', async () => {
    await recordUndispatchedAnswer(env, who, result({ outcome: 'response_cache_hit', cachedUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }));
    expect(recordAvoidedCall).toHaveBeenCalledWith({}, env, expect.objectContaining({ tenantId: 4, source: 'response_cache', promptTokens: 10, completionTokens: 5, estimated: false }));
    expect(recordServedWithoutModel).not.toHaveBeenCalled();
  });

  it('counts a deterministic answer with a zero-token counter row', async () => {
    await recordUndispatchedAnswer(env, who, result({ outcome: 'deterministic', resolvedModel: 'deterministic/arithmetic' }));
    expect(recordServedWithoutModel).toHaveBeenCalledWith({}, env, expect.objectContaining({ tenantId: 4, source: 'deterministic', model: 'deterministic/arithmetic' }));
    expect(recordAvoidedCall).not.toHaveBeenCalled();
  });

  it('still counts a cache hit whose original usage was not stored', async () => {
    await recordUndispatchedAnswer(env, who, result({ outcome: 'response_cache_hit' }));
    expect(recordServedWithoutModel).toHaveBeenCalledWith({}, env, expect.objectContaining({ source: 'response_cache' }));
  });

  it('records nothing for a dispatched call', () => {
    expect(recordUndispatchedAnswer(env, who, result({ outcome: 'primary' } as Partial<ProxyResult>))).toBeUndefined();
    expect(recordAvoidedCall).not.toHaveBeenCalled();
    expect(recordServedWithoutModel).not.toHaveBeenCalled();
  });
});
