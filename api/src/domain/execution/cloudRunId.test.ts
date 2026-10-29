import { describe, expect, it } from 'vitest';
import { cloudRunId } from './cloudRunId';

describe('cloudRunId', () => {
  it('names a cloud run in the shared run-id space, namespaced away from any id a client reports', () => {
    expect(cloudRunId(9)).toBe('cloud:9');
    expect(cloudRunId(9)).not.toBe(cloudRunId(10));
  });

  it('is what a child run points back at: the same id for the owner row and the child\'s parentRunId', () => {
    const owner = cloudRunId(41);
    const child = { runId: cloudRunId(42), parentRunId: cloudRunId(41) };
    expect(child.parentRunId).toBe(owner);
  });
});
