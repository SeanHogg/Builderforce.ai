import { describe, expect, it } from 'vitest';
import { supportsCodeCompletion } from './finishEvidence';

describe('supportsCodeCompletion', () => {
  it('accepts executed mutations and verification', () => {
    expect(supportsCodeCompletion({ toolName: 'write_file', category: 'tool', result: 'committed' })).toBe(true);
    expect(supportsCodeCompletion({ toolName: 'run_command', category: 'tool', result: 'tests passed' })).toBe(true);
  });

  it('rejects prose, failed calls, and blocked mutations', () => {
    expect(supportsCodeCompletion({ toolName: 'agent.message', category: 'message', result: 'done' })).toBe(false);
    expect(supportsCodeCompletion({ toolName: 'write_file', category: 'tool', result: '{"ok":false}' })).toBe(false);
    expect(supportsCodeCompletion({ toolName: 'write_file', category: 'tool', result: 'write refused' })).toBe(false);
  });
});
