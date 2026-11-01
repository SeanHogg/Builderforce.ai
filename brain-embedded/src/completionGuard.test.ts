import { describe, expect, it } from 'vitest';
import { canCompleteTicket, completionAdvisory, isTicketCompletion, notOnBaseBranchAdvisory, PlaceholderLedger } from './completionGuard';

/**
 * Chat #126 marked #2747 done over `// For now, we'll try without token for public repos`
 * — the placeholder guard had flagged it on the write, and nothing spoke at the claim.
 */
describe('completion guard', () => {
  const STUB = "// For now, we'll try without token for public repos";

  it('recognises a ticket being marked done', () => {
    expect(isTicketCompletion('builtin_tasks_update', { id: 2747, status: 'done' })).toBe(true);
    expect(isTicketCompletion('builtin_tasks_update', { id: 2747, status: 'in_progress' })).toBe(false);
    expect(isTicketCompletion('builtin_tasks_get', { id: 2747, status: 'done' })).toBe(false);
  });

  it('keeps a placeholder outstanding until an edit removes it', () => {
    const ledger = new PlaceholderLedger();
    const path = 'api/src/presentation/routes/githubWebhookRoutes.ts';
    ledger.record('edit_file', { path, old_string: 'x', new_string: STUB }, [{ path, text: STUB }]);
    expect(completionAdvisory(ledger.outstanding())).toContain('MARKED DONE OVER A PLACEHOLDER');
    ledger.record('edit_file', { path, old_string: STUB, new_string: 'const token = await resolveToken();' }, []);
    expect(ledger.outstanding()).toEqual([]);
    expect(completionAdvisory(ledger.outstanding())).toBeNull();
  });

  it('a full rewrite replaces what the ledger knew about the file', () => {
    const ledger = new PlaceholderLedger();
    ledger.record('write_file', { path: 'a.ts', content: '// TODO wire it' }, [{ path: 'a.ts', text: '// TODO wire it' }]);
    ledger.record('write_file', { path: 'a.ts', content: 'export const wired = true;' }, []);
    expect(ledger.outstanding()).toEqual([]);
  });

  it("counts a delegated child's placeholders as outstanding", () => {
    const ledger = new PlaceholderLedger();
    ledger.add([{ path: 'b.ts', text: '// TODO' }]);
    expect(ledger.outstanding()).toEqual([{ path: 'b.ts', text: '// TODO' }]);
  });
});

describe('canCompleteTicket base-branch guard', () => {
  it('allows completion when code is on the base branch', () => {
    expect(canCompleteTicket(true, false)).toBe(true);
    expect(canCompleteTicket(true, true)).toBe(true);
  });

  it('allows completion when the user declined shipping', () => {
    expect(canCompleteTicket(false, true)).toBe(true);
    expect(canCompleteTicket(false, true, { ticketGitBranch: 'feature/x' })).toBe(true);
  });

  // The ticket #6434 false positive: a delta ticket minted with `gitBranch: null`, no
  // `githubPrUrl`, and a run that performed no code-write this run at all. There is no
  // branch evidence pointing either way, so the guard must NOT assert non-landing.
  it('allows completion when the ticket has no git branch evidence and this run wrote no code', () => {
    expect(canCompleteTicket(false, false, { wroteCodeThisRun: false, ticketGitBranch: null })).toBe(true);
    expect(canCompleteTicket(false, false, { wroteCodeThisRun: false })).toBe(true);
  });

  it('blocks completion when this run wrote code and did not ship it to base', () => {
    expect(canCompleteTicket(false, false, { wroteCodeThisRun: true })).toBe(false);
    expect(canCompleteTicket(false, false, { wroteCodeThisRun: true, ticketGitBranch: null })).toBe(false);
  });

  it('blocks completion when the ticket records a non-base branch, even with no run write', () => {
    expect(canCompleteTicket(false, false, { wroteCodeThisRun: false, ticketGitBranch: 'feature/mobile-height' })).toBe(false);
    expect(canCompleteTicket(false, false, { wroteCodeThisRun: true, ticketGitBranch: 'feature/mobile-height' })).toBe(false);
  });

  it('still emits the advisory text for real unshipped work', () => {
    expect(notOnBaseBranchAdvisory()).toContain('CANNOT MARK DONE');
    expect(notOnBaseBranchAdvisory()).toContain('base branch');
  });
});
