import { describe, expect, it } from 'vitest';
import { pickResolvedAgentRow, stripAgentRuntimeSuffix } from './agentPersonaBrief';

describe('stripAgentRuntimeSuffix', () => {
  it('strips a nested V2 container roster suffix', () => {
    expect(stripAgentRuntimeSuffix('Bob Developer (V2 (Container))')).toBe('Bob Developer');
  });

  it('strips stacked runtime groups', () => {
    expect(stripAgentRuntimeSuffix('John Coder (V2) (Durable)')).toBe('John Coder');
  });

  it('leaves a bare name alone', () => {
    expect(stripAgentRuntimeSuffix('Ada')).toBe('Ada');
  });

  it('does not strip a parenthetical glued to the name', () => {
    expect(stripAgentRuntimeSuffix('fn()')).toBe('fn()');
  });
});

describe('pickResolvedAgentRow', () => {
  const bob = { id: 'd02ff7ee-9cf2-4c44-8558-c89104f6278f', name: 'Bob Developer (V2 (Container))' };
  const ada = { id: 'ada-id', name: 'Ada' };

  it('matches "Bob Developer" to the roster name with a runtime suffix', () => {
    expect(pickResolvedAgentRow([bob, ada], 'Bob Developer')).toEqual(bob);
  });

  it('matches case-insensitively', () => {
    expect(pickResolvedAgentRow([bob], 'bob developer')).toEqual(bob);
  });

  it('matches an exact id', () => {
    expect(pickResolvedAgentRow([bob, ada], bob.id)).toEqual(bob);
  });

  it('matches the full roster name', () => {
    expect(pickResolvedAgentRow([bob], 'Bob Developer (V2 (Container))')).toEqual(bob);
  });

  it('does not prefix-match a shorter name', () => {
    expect(pickResolvedAgentRow([bob], 'Bob')).toBeNull();
  });

  it('returns null when two teammates share the stripped name', () => {
    const other = { id: 'other', name: 'Bob Developer (V2 (Durable))' };
    expect(pickResolvedAgentRow([bob, other], 'Bob Developer')).toBeNull();
  });

  it('returns null for an unknown name', () => {
    expect(pickResolvedAgentRow([bob, ada], 'Kevin')).toBeNull();
  });
});
