import { describe, expect, it } from 'vitest';
import { cloudRunId, isReservedClientRunId } from './cloudRunId';

describe('cloudRunId', () => {
  it('names a cloud run in the shared run-id space', () => {
    expect(cloudRunId(9)).toBe('cloud:9');
    expect(cloudRunId(9)).not.toBe(cloudRunId(10));
  });

  it('a client-reported run id may not claim the cloud namespace (so the two id spaces cannot collide)', () => {
    expect(isReservedClientRunId('cloud:9')).toBe(true);
    expect(isReservedClientRunId('  cloud:anything')).toBe(true);
    expect(isReservedClientRunId('vscode:9')).toBe(false);
    expect(isReservedClientRunId('9')).toBe(false);
    expect(isReservedClientRunId(cloudRunId(41))).toBe(true);
  });
});
