import { describe, expect, it } from 'vitest';
import { completionAdvisory, isTicketCompletion, PlaceholderLedger } from './completionGuard';

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
