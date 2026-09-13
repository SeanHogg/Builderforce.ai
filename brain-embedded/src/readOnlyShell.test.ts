import { describe, it, expect } from 'vitest';
import { isReadOnlyShellCommand } from './readOnlyShell';

describe('isReadOnlyShellCommand', () => {
  it('accepts the read-only commands a ticket review actually ran', () => {
    for (const command of [
      'cd "c:\\code\\agentic\\Builderforce.ai" && git branch -a',
      'cd "c:\\code\\agentic\\Builderforce.ai" && git branch --format "%(refname:short)" | head -30',
      'cd repo && for branch in codex/a codex/b; do echo "=== $branch ==="; git log main..$branch --oneline 2>/dev/null | head -5 || echo "No changes"; done',
      'git branch --format "%(refname:short)" | grep -v "main" | while read branch; do count=$(git rev-list main..$branch --count 2>/dev/null); if [ "$count" -gt 0 ]; then echo "$branch: $count commits"; fi; done | head -30',
      'git status --short',
      'git -C Builderforce.ai log --oneline -5',
      'ls -la && cat package.json',
      'rg -n "foo" src | wc -l',
      'git remote -v',
      'git stash list',
      'node --version',
    ]) {
      expect(isReadOnlyShellCommand(command), command).toBe(true);
    }
  });

  it('refuses anything that can write, and anything it does not recognise', () => {
    for (const command of [
      'pnpm typecheck',
      'npx prettier --write .',
      'git checkout main',
      'git branch new-feature',
      'git branch -D old',
      'git merge origin/main',
      'git push origin main',
      'git tag v1.0',
      'sed -i "s/a/b/" file.ts',
      'find . -name "*.tmp" -delete',
      'find . -exec rm {} \\;',
      'echo hi > out.txt',
      'git log >> history.txt',
      'cat a | tee b',
      'node script.js',
      'rm -rf dist',
      'echo `rm -rf x`',
      'x=$(rm -rf dist)',
      'git config user.name bob',
      '',
    ]) {
      expect(isReadOnlyShellCommand(command), command).toBe(false);
    }
  });

  it('accepts output sent only to a null device or another descriptor', () => {
    expect(isReadOnlyShellCommand('git log 2>/dev/null')).toBe(true);
    expect(isReadOnlyShellCommand('git status 2>&1')).toBe(true);
    expect(isReadOnlyShellCommand('dir > NUL')).toBe(true);
  });

  it('refuses an unbalanced command rather than guessing where it ends', () => {
    expect(isReadOnlyShellCommand('echo "unterminated')).toBe(false);
    expect(isReadOnlyShellCommand('echo $(git log')).toBe(false);
  });
});
