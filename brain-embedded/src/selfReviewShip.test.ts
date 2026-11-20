import { describe, it, expect } from 'vitest';
import { DEFAULT_SHIP_POLICY, narrowByHold, shipPolicyOf } from '@builderforce/run-guards';
import {
  attemptedPublish,
  declinesShipping,
  leftChangeUnshipped,
} from './selfReviewShip';
import { publishHoldFromPersonTurns } from './runStore/publishHold';
import type { BrainTraceEvent } from './brainTriage';

let seq = 0;
function step(label: string, args: unknown, result: unknown = { ok: true }, isError = false): BrainTraceEvent {
  seq += 1;
  return { ts: new Date(seq * 1000).toISOString(), category: 'tool', label, args, result, isError };
}

const IDE_TOOLS = ['read_file', 'edit_file', 'write_file', 'run_command', 'git_status', 'git_diff', 'git_commit', 'git_push', 'open_pull_request'];
const EDIT = step('edit_file', { path: 'src/a.ts' });

const base = {
  codeChanged: true,
  toolNames: IDE_TOOLS,
  requestText: 'Fix the deep link so the ticket drawer opens',
  events: [EDIT],
  policy: DEFAULT_SHIP_POLICY,
};

describe('leftChangeUnshipped', () => {
  it('fires on the measured case: code changed, change requested, nothing committed or pushed', () => {
    expect(leftChangeUnshipped(base)).toBe(true);
  });

  it('is quiet when the run changed no code', () => {
    expect(leftChangeUnshipped({ ...base, codeChanged: false })).toBe(false);
  });

  it('is quiet on a host that cannot commit and push (the web Brain)', () => {
    expect(leftChangeUnshipped({ ...base, toolNames: ['builtin_tasks_create', 'builtin_chats_list_tickets'] })).toBe(false);
    // Commit without push cannot land anything either.
    expect(leftChangeUnshipped({ ...base, toolNames: ['edit_file', 'git_commit'] })).toBe(false);
  });

  it('is quiet when the user asked a question rather than for a change', () => {
    expect(leftChangeUnshipped({ ...base, requestText: 'Why does the deep link show an empty board?' })).toBe(false);
  });

  it('is quiet when the user said not to commit (the hold narrows the policy to leave_uncommitted)', () => {
    const requestText = "Fix the deep link but don't commit it yet";
    const policy = narrowByHold(DEFAULT_SHIP_POLICY, publishHoldFromPersonTurns([{ text: requestText }]));
    expect(policy.mode).toBe('leave_uncommitted');
    expect(leftChangeUnshipped({ ...base, requestText, policy })).toBe(false);
  });

  it('reads only the policy: quiet under leave_uncommitted (a setting or a sub-agent), firing under every shipping mode', () => {
    expect(leftChangeUnshipped({ ...base, policy: shipPolicyOf('leave_uncommitted', 'project_settings') })).toBe(false);
    expect(leftChangeUnshipped({ ...base, policy: shipPolicyOf('leave_uncommitted', 'subagent') })).toBe(false);
    for (const mode of ['commit', 'commit_push', 'pull_request'] as const) {
      expect(leftChangeUnshipped({ ...base, policy: shipPolicyOf(mode, 'project_settings') }), mode).toBe(true);
    }
  });

  it('is quiet once a publish was ATTEMPTED — even one that failed or was declined', () => {
    const declined = step('git_commit', { paths: ['src/a.ts'], allowBaseBranch: true }, { ok: false, error: 'declined by user' }, true);
    expect(leftChangeUnshipped({ ...base, events: [EDIT, declined] })).toBe(false);
    const pr = step('open_pull_request', { title: 't' });
    expect(leftChangeUnshipped({ ...base, events: [EDIT, pr] })).toBe(false);
  });
});

describe('attemptedPublish', () => {
  it('counts the publish tools and a raw git commit/push through the shell', () => {
    expect(attemptedPublish([step('git_push', { allowBaseBranch: true })])).toBe(true);
    expect(attemptedPublish([step('run_command', { command: 'git -C Builderforce.ai commit -m x' })])).toBe(true);
    expect(attemptedPublish([step('run_command', { command: 'git push origin main' })])).toBe(true);
    expect(attemptedPublish([step('run_command', { command: 'gh pr create --fill' })])).toBe(true);
  });

  it('does not count a merged-branch cleanup as shipping', () => {
    expect(attemptedPublish([step('git_cleanup_merged', { branch: 'feat/x' })])).toBe(false);
  });

  it('does not count reads, status, diff or a build', () => {
    expect(attemptedPublish([
      step('git_status', {}),
      step('git_diff', {}),
      step('run_command', { command: 'pnpm --filter builderforce-api type-check' }),
      EDIT,
    ])).toBe(false);
  });
});

describe('declinesShipping', () => {
  it('reads explicit negations and keep-it-local instructions', () => {
    for (const t of ["don't commit", 'do not push this', 'fix it without committing', 'no commit please', 'leave it uncommitted', 'keep the changes local']) {
      expect(declinesShipping(t), t).toBe(true);
    }
  });

  it('does not read an ordinary work order as a refusal', () => {
    for (const t of ['Fix the bug', 'rebase, merge to main and close the ticket', 'commit and push when done', null]) {
      expect(declinesShipping(t), String(t)).toBe(false);
    }
  });
});
