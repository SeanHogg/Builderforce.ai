/**
 * Mock modules test (TIAJ-13).
 * Ensures mock exports are reachable and pass minimal sanity checks.
 * Coverage excluded.
 */

import { mockMessages } from '@builderforce/test-workspace/messages';

describe('mock-modules', () => {
  test('mock exported functions exist', () => {
    expect(mockMessages).toBeDefined();
    expect(typeof mockMessages.createSyncEntry).toBe('function');
    expect(typeof mockMessages.getDisplayText).toBe('function');
  });
});