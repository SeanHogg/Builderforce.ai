import { describe, expect, it } from 'vitest';
import { decideReturnBlock, describeReturnBlock } from './returnToImplementation';

/**
 * Returning a code ticket to implementation when its repository is unavailable is a
 * re-dispatch into an infrastructure failure: the producer re-runs, cannot land a branch,
 * reaches review with nothing, and is returned again. The 2026-09-16 burst on project 11
 * recorded `ticket.prd.reconcile_needed` "no repo bound to this task" on 22 re-dispatched
 * tickets. That is a person's to fix, so the return is HELD and surfaced instead.
 */
describe('decideReturnBlock', () => {
  it('holds a code ticket whose repository is not bound', () => {
    expect(decideReturnBlock({ expectsCode: true, repo: { ok: false, reason: 'no repo bound to this task' } }))
      .toBe('no repo bound to this task');
  });

  it('holds a code ticket whose repository credential does not resolve', () => {
    expect(decideReturnBlock({ expectsCode: true, repo: { ok: false, reason: 'credential revoked' } })).toBe('credential revoked');
  });

  it('returns it normally when the repository is usable', () => {
    expect(decideReturnBlock({ expectsCode: true, repo: { ok: true } })).toBeNull();
  });

  it('is not the gate for non-code work — its deliverable is not a branch', () => {
    expect(decideReturnBlock({ expectsCode: false, repo: { ok: false, reason: 'no repo bound to this task' } })).toBeNull();
  });

  it('treats an UNKNOWN repository state as no verdict — the return proceeds as it always did', () => {
    expect(decideReturnBlock({ expectsCode: true, repo: null })).toBeNull();
  });

  it('says what a person has to do', () => {
    expect(describeReturnBlock('no repo bound to this task')).toMatch(/bind a repository/);
  });
});
