import { describe, it, expect } from 'vitest';
import { parseGitShortStatus, shippedToBaseBranch, BASE_BRANCHES } from './shipVerification';
import type { BrainTraceEvent } from './brainTriage';

let seq = 0;
function step(label: string, args: unknown, result: unknown, isError = false): BrainTraceEvent {
  seq += 1;
  return { ts: new Date(seq * 1000).toISOString(), category: 'tool', label, args, result, isError };
}
const push = (ok = true) =>
  step('run_command', { command: 'cd Builderforce.ai/frontend && git add -A && git commit -m "x" && git push' },
    ok ? { ok: true, output: 'main -> main' } : { ok: false, output: 'rejected' }, !ok);
const status = (output: string) => step('git_status', { repo: 'Builderforce.ai/frontend' }, { ok: true, action: 'status', output });

describe('parseGitShortStatus', () => {
  it('reads the branch and upstream off the header', () => {
    // Verbatim from the run: the header is the whole signal, the file lines are not.
    expect(parseGitShortStatus('## main...origin/main\n M src/components/home/LandingCanvasHero.module.css'))
      .toEqual({ branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 });
  });

  it('reads ahead/behind counts', () => {
    expect(parseGitShortStatus('## main...origin/main [ahead 2]')).toMatchObject({ ahead: 2, behind: 0 });
    expect(parseGitShortStatus('## main...origin/main [ahead 1, behind 3]')).toMatchObject({ ahead: 1, behind: 3 });
    expect(parseGitShortStatus('## main...origin/main [behind 3]')).toMatchObject({ ahead: 0, behind: 3 });
  });

  it('reports a branch with no upstream as having none', () => {
    expect(parseGitShortStatus('## feature/x')).toEqual({ branch: 'feature/x', upstream: null, ahead: 0, behind: 0 });
  });

  it('returns null when there is no header — "could not tell" is not "clean"', () => {
    expect(parseGitShortStatus('')).toBeNull();
    expect(parseGitShortStatus(' M src/a.ts')).toBeNull();
  });

  it('handles a detached HEAD without claiming a branch', () => {
    expect(parseGitShortStatus('## HEAD (no branch)')).toMatchObject({ branch: null });
  });
});

describe('shippedToBaseBranch', () => {
  it('confirms the run that pushed to main and verified it landed', () => {
    // The exact shape of the reported run: edit, commit+push, then a status showing
    // main tracking origin/main with nothing left to push.
    expect(shippedToBaseBranch([push(), status('## main...origin/main')])).toBe(true);
  });

  it('accepts a status taken via run_command rather than the tool', () => {
    expect(shippedToBaseBranch([
      push(),
      step('run_command', { command: 'git status --short --branch' }, { ok: true, output: '## master...origin/master' }),
    ])).toBe(true);
  });

  it('refuses when the push FAILED', () => {
    expect(shippedToBaseBranch([push(false), status('## main...origin/main')])).toBe(false);
  });

  it('refuses when there was no push at all — editing is not shipping', () => {
    expect(shippedToBaseBranch([
      step('edit_file', { path: 'a.css' }, { ok: true, replaced: 1 }),
      status('## main...origin/main'),
    ])).toBe(false);
  });

  it('refuses on a FEATURE branch — review is still pending there', () => {
    expect(shippedToBaseBranch([push(), status('## feature/mobile-height...origin/feature/mobile-height')])).toBe(false);
  });

  it('refuses when commits remain unpushed', () => {
    expect(shippedToBaseBranch([push(), status('## main...origin/main [ahead 1]')])).toBe(false);
  });

  it('refuses when the branch has no upstream — nothing was published', () => {
    expect(shippedToBaseBranch([push(), status('## main')])).toBe(false);
  });

  it('ignores a status taken BEFORE the push', () => {
    // A pre-push status says nothing about whether the push worked. Order is the
    // whole point: this is the sequence the reported run actually produced first.
    expect(shippedToBaseBranch([status('## main...origin/main'), push()])).toBe(false);
  });

  it('refuses when the post-push status is unreadable', () => {
    expect(shippedToBaseBranch([push(), status('')])).toBe(false);
  });

  it('is empty-safe', () => {
    expect(shippedToBaseBranch([])).toBe(false);
  });
});

describe('BASE_BRANCHES', () => {
  it('covers the two conventional defaults and nothing speculative', () => {
    // A repo with a differently-named base simply does not auto-complete — a false
    // negative, which is the safe direction: closing a ticket that did not ship is
    // worse than leaving one open.
    expect([...BASE_BRANCHES].sort()).toEqual(['main', 'master']);
  });
});
