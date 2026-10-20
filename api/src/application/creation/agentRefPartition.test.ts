import { describe, expect, it } from 'vitest';
import { partitionAgentRefs } from './agentRefPartition';

describe('partitionAgentRefs', () => {
  it('keeps a built-in agent id away from the uuid registrations column', () => {
    const p = partitionAgentRefs(['validator-t12', '42', '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c']);
    expect(p).toEqual({
      numeric: [42],
      text: ['validator-t12', '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c'],
      uuid: ['3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c'],
    });
  });

  it('rejects a numeric ref outside int4', () => {
    expect(partitionAgentRefs(['9999999999'])).toBeNull();
    expect(partitionAgentRefs(['0'])).toBeNull();
  });
});
