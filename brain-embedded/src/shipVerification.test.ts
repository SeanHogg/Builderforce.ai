import { describe, it, expect } from 'vitest';
import { parseGitShortStatus, shippedToBaseBranch, dirtyPathsOf, BASE_BRANCHES } from './shipVerification';
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

  it('sees a raw push aimed at one checkout of a multi-repo workspace (`git -C <repo> push`)', () => {
    const scoped = step('run_command', { command: 'git -C Builderforce.ai push origin main' }, { ok: true, output: 'main -> main' });
    expect(shippedToBaseBranch([scoped, status('## main...origin/main')])).toBe(true);
  });

  it('accepts a status taken via run_command rather than the tool', () => {
    expect(shippedToBaseBranch([
      push(),
      step('run_command', { command: 'git status --short --branch' }, { ok: true, output: '## master...origin/master' }),
    ])).toBe(true);
  });

  it('accepts a push made through the git_push TOOL, not just a raw shell push', () => {
    // The tool's args are `{ allowBaseBranch, repo }` and carry no command string, so
    // reading commands alone made the SAFE, declared route invisible: a run that shipped
    // the way we tell it to never counted as having pushed, and every delta ticket it
    // opened stayed at 50% on the board forever.
    const toolPush = step('git_push', { allowBaseBranch: true }, { ok: true, action: 'push', output: 'Pushed main to origin' });
    expect(shippedToBaseBranch([toolPush, status('## main...origin/main')])).toBe(true);
  });

  it('does not treat a FAILED git_push tool call as a push', () => {
    const failed = step('git_push', { allowBaseBranch: true }, { ok: false, action: 'push', error: 'rejected' }, true);
    expect(shippedToBaseBranch([failed, status('## main...origin/main')])).toBe(false);
  });

  it('does not treat opening a pull request as shipping — the merge is another person\'s act', () => {
    const pr = step('open_pull_request', { title: 't' }, { ok: true, action: 'pull_request', output: 'https://github.com/x/y/pull/1' });
    expect(shippedToBaseBranch([pr, status('## main...origin/main')])).toBe(false);
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

  it('accepts the git_push tool\'s OWN post-push status as the verification', () => {
    // The tool now prints `git status --short --branch` after pushing, so the declared
    // route verifies itself — no separate status call has to be remembered.
    const toolPush = step('git_push', { allowBaseBranch: true, repo: 'Builderforce.ai' },
      { ok: true, action: 'push', output: 'Pushed main to origin\n## main...origin/main' });
    expect(shippedToBaseBranch([toolPush])).toBe(true);
  });

  it('refuses when the push\'s own status still shows commits ahead', () => {
    const toolPush = step('git_push', { allowBaseBranch: true },
      { ok: true, action: 'push', output: 'Pushed main to origin\n## main...origin/main [ahead 1]' });
    expect(shippedToBaseBranch([toolPush])).toBe(false);
  });

  it('refuses when a file THIS run touched is still uncommitted after the push', () => {
    // Some commit reached main, but not the change this run made — that change did not
    // ship, whatever the header says. Touched paths are workspace-relative; status paths
    // are repo-relative, so the match is by suffix.
    const toolPush = step('git_push', { allowBaseBranch: true, repo: 'Builderforce.ai' },
      { ok: true, action: 'push', output: 'Pushed main to origin\n## main...origin/main\n M brain-embedded/src/a.ts' });
    expect(shippedToBaseBranch([toolPush], { touchedFiles: ['Builderforce.ai/brain-embedded/src/a.ts'] })).toBe(false);
    // Someone else's dirty file is not this run's concern.
    expect(shippedToBaseBranch([toolPush], { touchedFiles: ['Builderforce.ai/brain-embedded/src/b.ts'] })).toBe(true);
  });

  it('refuses when a file this run CREATED is still untracked', () => {
    const toolPush = step('git_push', { allowBaseBranch: true },
      { ok: true, action: 'push', output: 'Pushed main to origin\n## main...origin/main\n?? src/new.ts' });
    expect(shippedToBaseBranch([toolPush], { touchedFiles: ['src/new.ts'] })).toBe(false);
  });
});

describe('dirtyPathsOf', () => {
  it('lists modified, untracked and renamed paths, and skips the header', () => {
    expect(dirtyPathsOf('## main...origin/main\n M a.ts\n?? b/c.ts\nR  old.ts -> new.ts\n D "with space.ts"'))
      .toEqual(['a.ts', 'b/c.ts', 'new.ts', 'with space.ts']);
  });

  it('is empty for a clean tree', () => {
    expect(dirtyPathsOf('## main...origin/main')).toEqual([]);
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
