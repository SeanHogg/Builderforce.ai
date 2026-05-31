import { describe, it, expect, beforeEach } from 'vitest';
import { savePendingPrompt, takePendingPrompt } from './pendingPrompt';

describe('pendingPrompt handoff', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a saved prompt and clears it (single-use)', () => {
    savePendingPrompt('Audit my repo for security issues');
    expect(takePendingPrompt()).toBe('Audit my repo for security issues');
    // Cleared after the first take — a refresh/re-mount must not replay it.
    expect(takePendingPrompt()).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(takePendingPrompt()).toBeNull();
  });

  it('trims whitespace and ignores empty input', () => {
    savePendingPrompt('   ');
    expect(takePendingPrompt()).toBeNull();

    savePendingPrompt('  build a support agent  ');
    expect(takePendingPrompt()).toBe('build a support agent');
  });
});
