import { describe, expect, it } from 'vitest';
import { MAX_PATH_LENGTH, validateWorkspacePath } from './index';

describe('validateWorkspacePath', () => {
  it('accepts a plain workspace-relative file', () => {
    expect(validateWorkspacePath('src/App.tsx')).toEqual({ ok: true });
    expect(validateWorkspacePath('a b/c-d_e.txt')).toEqual({ ok: true });
  });

  it.each([
    ['', 'Path is required'],
    ['/abs', 'Path must be workspace-relative (no leading /)'],
    ['dir/', 'Path must name a file, not a directory'],
    ['a\\b', 'Use forward slashes in paths'],
    ['a\u0000b', 'Path contains control characters'],
    ['a//b', 'Path contains an empty segment'],
    ['../x', 'Path traversal segments (./..) are not allowed'],
    ['./x', 'Path traversal segments (./..) are not allowed'],
    ['x'.repeat(MAX_PATH_LENGTH + 1), `Path exceeds ${MAX_PATH_LENGTH} characters`],
  ])('refuses %j', (path, reason) => {
    expect(validateWorkspacePath(path)).toEqual({ ok: false, reason });
  });
});
