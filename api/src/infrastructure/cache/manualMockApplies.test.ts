import { expect, it, vi } from 'vitest';

/**
 * Regression for the Windows drive-letter mismatch pinned in vitest.config.ts.
 * Vitest stores a manual `vi.mock` under a URL derived by case-sensitive
 * `startsWith(root)`. A `c:/` root and a `C:/` resolved id used to register
 * the mock as `/@fs/C:/…` while the import requested `/src/…`, so `vi.mock`
 * was a silent no-op. This fails if that split comes back.
 */
vi.mock('./readThroughCache', () => ({
  getOrSetCached: () => 'mocked',
}));

const { getOrSetCached } = await import('./readThroughCache');

it('a manual vi.mock replaces the module export', () => {
  // The mock ignores its arguments; the real signature only types the call.
  const call = getOrSetCached as unknown as () => unknown;
  expect(call()).toBe('mocked');
});
