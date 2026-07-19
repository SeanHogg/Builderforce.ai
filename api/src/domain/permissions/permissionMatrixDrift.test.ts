import { describe, it, expect } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS as API_MATRIX } from './permissionRegistry';
// The client-side mirror. api and frontend are separate build roots with no shared
// package, so this test is the ONLY thing keeping the two role→permission matrices
// in lock-step. A relative import across roots is fine here: the frontend file is
// pure TS with no runtime dependencies.
import { DEFAULT_ROLE_PERMISSIONS as FRONTEND_MATRIX } from '../../../../frontend/src/lib/permissions';

/** Sort each role's permission list so ordering differences never trip the guard. */
function normalize(matrix: Record<string, readonly string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(matrix).map(([role, perms]) => [role, [...perms].sort()]),
  );
}

describe('permission matrix drift', () => {
  it('frontend mirror matches the authoritative api matrix exactly', () => {
    expect(normalize(FRONTEND_MATRIX)).toEqual(normalize(API_MATRIX));
  });
});
