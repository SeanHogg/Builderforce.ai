import { describe, expect, it } from 'vitest';
import { BATCH_USE_CASES, chooseBatchTarget, pinnedBatchModel } from './batchTarget';
import { BATCH_CALLBACK_KINDS } from './batchTypes';
import type { ProviderKeySummary } from '../tenantProviderKeyService';

const conn = (provider: ProviderKeySummary['provider'], authType: ProviderKeySummary['authType']): ProviderKeySummary =>
  ({ id: `${provider}-${authType}`, provider, authType, priority: null });
const allOperatorKeys = () => true;
const noOperatorKeys = () => false;

describe('BATCH_USE_CASES', () => {
  it('declares a policy for every callback kind', () => {
    for (const kind of BATCH_CALLBACK_KINDS) expect(BATCH_USE_CASES[kind], kind).toBeDefined();
  });
});

describe('chooseBatchTarget', () => {
  const memory = BATCH_USE_CASES.project_memory;

  it('runs a tenant-funded call on the tenant’s own batchable api key, in their precedence order', () => {
    const r = chooseBatchTarget(memory, [conn('xai', 'api_key'), conn('openai', 'api_key'), conn('anthropic', 'api_key')], allOperatorKeys);
    expect(r).toEqual({ ok: true, target: { vendor: 'openai', model: memory.models!.openai, funding: 'byo' } });
  });

  it('keeps a call synchronous when the tenant’s account cannot batch it — never moves it onto the operator key', () => {
    const r = chooseBatchTarget(memory, [conn('anthropic', 'oauth')], allOperatorKeys);
    expect(r).toEqual({ ok: false, reason: 'tenant_account_not_batchable' });
  });

  it('falls to the operator key when the tenant has no connection and the sync path is platform-funded', () => {
    const r = chooseBatchTarget(memory, [], allOperatorKeys);
    expect(r).toEqual({ ok: true, target: { vendor: 'anthropic', model: memory.models!.anthropic, funding: 'platform' } });
  });

  it('refuses when no credential can carry the batch', () => {
    expect(chooseBatchTarget(memory, [], noOperatorKeys)).toEqual({ ok: false, reason: 'no_batch_credential' });
  });

  it('never batches the free-pool classifier (neither a tenant key nor the paid operator key)', () => {
    const r = chooseBatchTarget(BATCH_USE_CASES.task_action_type, [conn('anthropic', 'api_key')], allOperatorKeys);
    expect(r).toEqual({ ok: false, reason: 'no_batch_credential' });
  });

  it('batches a pinned teacher only on its own provider', () => {
    const teacher = BATCH_USE_CASES.evermind_teacher;
    expect(chooseBatchTarget(teacher, [], allOperatorKeys, 'claude-opus-5-5')).toEqual({
      ok: true, target: { vendor: 'anthropic', model: 'claude-opus-5-5', funding: 'platform' },
    });
    // A subscription for the teacher's provider funds the sync call at $0 to us.
    expect(chooseBatchTarget(teacher, [conn('anthropic', 'oauth')], allOperatorKeys, 'claude-opus-5-5'))
      .toEqual({ ok: false, reason: 'tenant_account_not_batchable' });
    // A connection for some OTHER provider does not fund this teacher.
    expect(chooseBatchTarget(teacher, [conn('xai', 'api_key')], allOperatorKeys, 'claude-opus-5-5'))
      .toMatchObject({ ok: true, target: { funding: 'platform' } });
    expect(chooseBatchTarget(teacher, [], allOperatorKeys)).toEqual({ ok: false, reason: 'no_model' });
  });
});

describe('pinnedBatchModel', () => {
  it('maps a direct Anthropic id onto the anthropic batch provider', () => {
    expect(pinnedBatchModel('claude-opus-5-5')).toEqual({ vendor: 'anthropic', model: 'claude-opus-5-5' });
  });

  it('names the provider when it has no batch API', () => {
    const r = pinnedBatchModel('openrouter/mistralai/mistral-large');
    expect('reason' in r && r.reason).toMatch(/^no_batch_api:/);
  });
});
