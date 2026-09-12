import { describe, it, expect } from 'vitest';
import {
  attemptedPublish,
  declinesShipping,
  leftChangeUnshipped,
  selfReviewShipDirective,
  unshippedChangeNudge,
} from './selfReviewShip';
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

  it('is quiet when the user said not to commit', () => {
    expect(leftChangeUnshipped({ ...base, requestText: "Fix the deep link but don't commit it yet" })).toBe(false);
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

describe('the contract text', () => {
  it('names the order and the tools, with the chat id baked in', () => {
    const d = selfReviewShipDirective(103);
    expect(d).toContain('YOU are its reviewer');
    for (const name of ['git_diff', 'builtin_reviews_record', 'git_commit', 'git_push', 'allowBaseBranch:true', 'chatId=103', 'open_pull_request']) {
      expect(d).toContain(name);
    }
    // Verify → review → ship → close, in that order.
    const order = ['VERIFY', 'SELF-REVIEW', 'SHIP', 'CLOSE'].map((w) => d.indexOf(`${w} —`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the nudge names what is left rather than accusing the model of doing nothing', () => {
    const n = unshippedChangeNudge();
    expect(n).toMatch(/changed code/);
    expect(n).toContain('git_commit');
    expect(n).toContain('git_push');
    expect(n).not.toMatch(/zero tool calls/);
  });
});
