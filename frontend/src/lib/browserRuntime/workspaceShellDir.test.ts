import { describe, expect, it } from 'vitest';
import { inWorkspaceDir } from './workspaceShell';

/**
 * The shared tools hand a working directory to the shell as `ShellRunOptions.cwd`. The in-browser
 * runtime's `bfsh -c` takes only a command line, so ITS adapter — and only it — writes the `cd`.
 */
describe('inWorkspaceDir', () => {
  it('leaves the command alone with no directory (or the root)', () => {
    expect(inWorkspaceDir('npm test', undefined)).toBe('npm test');
    expect(inWorkspaceDir('npm test', '.')).toBe('npm test');
  });

  it('scopes a one-liner and a multi-line script into the directory', () => {
    expect(inWorkspaceDir('npm test', 'app')).toBe('cd "app" && npm test');
    expect(inWorkspaceDir('set -e\nnpm test', 'app')).toBe('cd "app" || exit 1\nset -e\nnpm test');
  });
});
