import { describe, expect, it } from 'vitest';
import { accountTypeGetsWorkspace, starterWorkspaceName } from './starterWorkspace';

describe('starterWorkspaceName', () => {
  it('names the workspace after who the builder is', () => {
    expect(starterWorkspaceName({ displayName: 'Acme', email: 'owner@acme.test' })).toBe("Acme's Workspace");
    expect(starterWorkspaceName({ displayName: '', username: 'sean' })).toBe("sean's Workspace");
    expect(starterWorkspaceName({ email: 'sean@example.test' })).toBe("sean's Workspace");
  });

  it('falls back when there is nothing to name it after', () => {
    expect(starterWorkspaceName({})).toBe('My workspace');
    expect(starterWorkspaceName({ displayName: null, username: null, email: null })).toBe('My workspace');
  });

  it("does not stutter when the identity already ends in 'workspace'", () => {
    expect(starterWorkspaceName({ displayName: 'Design Workspace' })).toBe('Design Workspace');
  });
});

describe('accountTypeGetsWorkspace', () => {
  it('provisions for builders, including the unset default', () => {
    // An OAuth account has not made the Build-vs-Hired choice yet and carries the
    // column default — it must still get a workspace, because "the user never
    // finished a gate" is exactly the drop-off that used to leave accounts at zero.
    expect(accountTypeGetsWorkspace('standard')).toBe(true);
    expect(accountTypeGetsWorkspace(null)).toBe(true);
    expect(accountTypeGetsWorkspace(undefined)).toBe(true);
  });

  it('skips the shells that legitimately have no workspace', () => {
    expect(accountTypeGetsWorkspace('freelancer')).toBe(false);
    expect(accountTypeGetsWorkspace('sales')).toBe(false);
  });
});
