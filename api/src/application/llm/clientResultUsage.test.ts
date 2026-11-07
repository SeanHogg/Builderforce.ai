import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ recordUsageRow: vi.fn() }));
vi.mock('./usageLedger', () => ({ recordUsageRow: mocks.recordUsageRow }));

import { clientResultModelRef, recordClientResultUsage } from './clientResultUsage';

describe('clientResultModelRef', () => {
  it('namespaces the model as an on-device ref and sanitizes it', () => {
    expect(clientResultModelRef({ engine: 'webllm', model: 'Llama-3.2-1B q4' })).toBe('local/webllm/Llama-3.2-1B-q4');
    expect(clientResultModelRef({ engine: 'bfi', model: '../../x;DROP' })).toBe('local/bfi/..-..-x-DROP');
  });
  it('bounds the length to 128', () => {
    expect(clientResultModelRef({ engine: 'browser', model: 'm'.repeat(128) }).length).toBe(128);
  });
});

describe('recordClientResultUsage', () => {
  beforeEach(() => mocks.recordUsageRow.mockReset());

  it('writes a local, utility-role, non-byo row with the user and project', async () => {
    await recordClientResultUsage({} as never, {} as never, {
      tenantId: 1, userId: 'u1', projectId: 7, useCase: 'brain_summary', provenance: { engine: 'bfi', model: 'qwen' },
    });
    const row = mocks.recordUsageRow.mock.calls[0]![2];
    expect(row).toMatchObject({
      tenantId: 1, userId: 'u1', model: 'local/bfi/qwen', byo: false, calls: 1,
      attribution: { role: 'utility', projectId: 7 },
    });
  });

  it('omits projectId when unattributed', async () => {
    await recordClientResultUsage({} as never, {} as never, { tenantId: 1, useCase: 'x', provenance: { engine: 'bfi', model: 'q' } });
    expect(mocks.recordUsageRow.mock.calls[0]![2].attribution).toEqual({ role: 'utility' });
  });
});
