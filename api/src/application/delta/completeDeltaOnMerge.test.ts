import { describe, expect, it } from 'vitest';
import { taskIdFromBranch } from './completeDeltaOnMerge';

/**
 * The branch-name join is the WEAKER of the two identities this closer accepts (the
 * strong one is a `task_id` this platform already recorded against the PR row), and it
 * is the one that can do damage: a pattern loose enough to match a human's branch would
 * silently complete somebody else's ticket, which is worse than leaving a delta ticket
 * open — a wrongly-closed ticket is invisible, a stale one is merely stale.
 *
 * So what it accepts is exactly the two conventions BuilderForce ITSELF creates, and
 * these cases pin both halves of that: every shape we generate resolves, and every shape
 * we do not generate resolves to nothing.
 */
describe('taskIdFromBranch', () => {
  it('reads the platform finalize convention', () => {
    expect(taskIdFromBranch('builderforce/task-2394')).toBe(2394);
  });

  it('reads the git_commit ticket-branch convention, with or without a slug', () => {
    expect(taskIdFromBranch('ticket/2394')).toBe(2394);
    expect(taskIdFromBranch('ticket/2394-mobile-board-height')).toBe(2394);
  });

  it('accepts a fully-qualified ref, as a webhook can send it', () => {
    expect(taskIdFromBranch('refs/heads/ticket/2394-fix')).toBe(2394);
    expect(taskIdFromBranch('  ticket/7  ')).toBe(7);
  });

  it('refuses branch names this platform does not create', () => {
    // A leading number in an unrecognised namespace is a coincidence, not an identity.
    for (const branch of [
      'feature/123-whatever',
      'fix/login-bug',
      'release/2026-09',
      'main',
      'ticket/abc',
      'ticket/',
      'my-ticket/2394',
      'builderforce/task-',
      'builderforce/feature-2394',
    ]) {
      expect(taskIdFromBranch(branch), branch).toBeNull();
    }
  });

  it('refuses a zero or absent id rather than returning a falsy task', () => {
    expect(taskIdFromBranch('ticket/0')).toBeNull();
    expect(taskIdFromBranch(null)).toBeNull();
    expect(taskIdFromBranch(undefined)).toBeNull();
    expect(taskIdFromBranch('')).toBeNull();
  });
});
