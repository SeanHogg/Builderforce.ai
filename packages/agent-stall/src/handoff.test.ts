import { describe, it, expect } from 'vitest';
import {
  canExecuteCommands,
  handsWorkToUser,
  delegatesExecutableWork,
  handoffRecoveryNudge,
} from './handoff';
import {
  stallShape,
  shouldRecoverStalledTurn,
  isExhaustedStall,
  stallRecoveryNudge,
  stallExhaustedNotice,
  modelFailoverNotice,
  MAX_ANNOUNCEMENT_RECOVERIES,
  type StalledTurnInput,
} from './index';

const IDE_TOOLS = ['read_file', 'edit_file', 'search_code', 'run_command', 'git_commit', 'git_push'];

describe('canExecuteCommands', () => {
  it('recognises both spellings that exist in this codebase', () => {
    expect(canExecuteCommands(['read_file', 'run_command'])).toBe(true);
    expect(canExecuteCommands(['Read', 'Bash', 'Grep'])).toBe(true);
  });

  it('counts the git publish tools — "you should commit and push" is the same handoff', () => {
    expect(canExecuteCommands(['read_file', 'git_commit'])).toBe(true);
    expect(canExecuteCommands(['read_file', 'open_pull_request'])).toBe(true);
  });

  it('is false for a surface that genuinely cannot run anything', () => {
    expect(canExecuteCommands(['read_file', 'builtin_tasks_create'])).toBe(false);
    expect(canExecuteCommands([])).toBe(false);
    expect(canExecuteCommands(undefined)).toBe(false);
  });
});

describe('handsWorkToUser', () => {
  it('catches the measured shape: edits applied, verification assigned to the user', () => {
    expect(
      handsWorkToUser(
        'I fixed the type errors in boardRoutes.ts and projectEvermindRoutes.ts.\n\n'
          + 'Now run:\n\n```bash\npnpm --filter builderforce-api type-check\n```\n',
      ),
    ).toBe(true);
  });

  it('catches a numbered next-steps list', () => {
    expect(
      handsWorkToUser(
        'The ratchet baselines are updated.\n\nNext steps:\n1. Run the frontend guards\n2. Commit the change\n3. Push to main\n',
      ),
    ).toBe(true);
  });

  it('catches the second-person forms', () => {
    expect(handsWorkToUser('The fix is in place. You will need to run `pnpm install` first.')).toBe(true);
    expect(handsWorkToUser("Done — you'll want to rebuild the extension bundle before testing.")).toBe(true);
    expect(handsWorkToUser('Please run the type-check to confirm.')).toBe(true);
    expect(handsWorkToUser('Once you have run the build, the error will be gone.')).toBe(true);
  });

  it('catches an unquoted script name — the handoff that never says `pnpm`', () => {
    expect(handsWorkToUser('I applied the edit. You should run the type-check before shipping.')).toBe(true);
  });

  it('leaves a report of what the agent itself ran alone', () => {
    expect(
      handsWorkToUser('I ran `pnpm type-check` and it passed, then committed as 4f1a2c and pushed to main.'),
    ).toBe(false);
  });

  it('leaves a shell line QUOTED inside a code block alone', () => {
    // The agent showing CI output must not read as the agent assigning homework.
    expect(
      handsWorkToUser('The failing step was:\n\n```\nRun pnpm install --frozen-lockfile\nLockfile is up to date\n```\n\nI have corrected the lockfile and re-ran the install here.'),
    ).toBe(false);
  });

  it('leaves a closing pointer at something to READ alone', () => {
    expect(handsWorkToUser('Everything is committed. You can review the diff on the PR when you have a moment.')).toBe(false);
    expect(handsWorkToUser('Done. The details are in the execution trace if you want to check the logs.')).toBe(false);
  });

  it('leaves a genuine boundary alone', () => {
    expect(
      handsWorkToUser('The code change is committed and pushed. You will need to add the CLOUDFLARE_API_TOKEN secret in the dashboard before the deploy can run.'),
    ).toBe(false);
    expect(handsWorkToUser('The extension is rebuilt. Restart VS Code to load it.')).toBe(false);
  });

  it('ignores a mid-answer aside — only the sign-off is a handoff', () => {
    const long = `${'The failure is a stale ratchet baseline. '.repeat(40)}I lowered the baseline to 171 and re-ran the guard here; it passes.`;
    expect(handsWorkToUser(long)).toBe(false);
  });

  it('is false for empty text', () => {
    expect(handsWorkToUser('')).toBe(false);
    expect(handsWorkToUser('   \n ')).toBe(false);
  });
});

describe('delegatesExecutableWork', () => {
  const text = 'I applied the fix. Now run `pnpm type-check` and commit the change.';

  it('fires when the run asked for a change and held the tools', () => {
    expect(delegatesExecutableWork(text, { availableToolNames: IDE_TOOLS, requestText: 'Fix the errors' })).toBe(true);
  });

  it('does NOT fire when the surface could not have run it', () => {
    expect(
      delegatesExecutableWork(text, { availableToolNames: ['read_file', 'search_code'], requestText: 'Fix the errors' }),
    ).toBe(false);
  });

  it('does NOT fire on a question — commands ARE the answer to "how do I…"', () => {
    expect(
      delegatesExecutableWork(text, { availableToolNames: IDE_TOOLS, requestText: 'How do I run the type-check locally?' }),
    ).toBe(false);
  });

  it('does NOT fire when the loop never supplied the context', () => {
    expect(delegatesExecutableWork(text, {})).toBe(false);
  });
});

describe('stallShape — the handoff folded into the shared gate', () => {
  const base: StalledTurnInput = {
    text: 'I applied the fix to boardRoutes.ts. Now run `pnpm type-check` and push.',
    toolCallCount: 0,
    availableToolCount: 64,
    recoveriesUsed: 0,
    availableToolNames: IDE_TOOLS,
    requestText: 'Fix the errors',
  };

  it('classifies the handoff and re-prompts it', () => {
    expect(stallShape(base)).toBe('handed-off');
    expect(shouldRecoverStalledTurn(base)).toBe(true);
  });

  it('is not a stall once the model actually called something', () => {
    expect(stallShape({ ...base, toolCallCount: 2 })).toBe(null);
    expect(shouldRecoverStalledTurn({ ...base, toolCallCount: 2 })).toBe(false);
  });

  it('escalates to exhausted on the same budget as every other shape', () => {
    const spent = { ...base, recoveriesUsed: MAX_ANNOUNCEMENT_RECOVERIES };
    expect(shouldRecoverStalledTurn(spent)).toBe(false);
    expect(isExhaustedStall(spent)).toBe(true);
  });

  it('an empty turn still wins — it is the more specific finding', () => {
    expect(stallShape({ ...base, text: '' })).toBe('empty');
  });

  it('leaves a finished report alone', () => {
    expect(
      stallShape({ ...base, text: 'I ran the type-check, it passed, and I pushed 4f1a2c to main.' }),
    ).toBe(null);
  });
});

describe('the handoff wording', () => {
  it('does not accuse the model of a promise it never made', () => {
    const nudge = stallRecoveryNudge(false, 'handed-off');
    expect(nudge).toBe(handoffRecoveryNudge(false));
    expect(nudge).not.toContain('zero tool calls');
    expect(nudge).toContain('run_command');
    expect(nudge).toContain('Verification you hand to the user is verification nobody does.');
  });

  it('escalates on the last chance to naming the change UNVERIFIED', () => {
    expect(handoffRecoveryNudge(true)).toContain('UNVERIFIED');
    expect(handoffRecoveryNudge(false)).not.toContain('UNVERIFIED');
  });

  it('keeps the original wording for every other shape', () => {
    expect(stallRecoveryNudge(false)).toContain('zero tool calls');
    expect(stallRecoveryNudge(false, 'announced')).toContain('zero tool calls');
  });

  it('tells the operator what actually happened, not a story about narration', () => {
    const notice = stallExhaustedNotice('direct/minimax/MiniMax-M1', [], 'handed-off');
    expect(notice).toContain('handed the remaining work back to you');
    expect(notice).toContain('UNVERIFIED');
    expect(notice).not.toContain('described tool calls');
    // An upstream rejection is the WRONG place to send this reader — the request worked.
    expect(notice).not.toContain('check your runtime or gateway log');
    expect(notice).toContain('coding pool');
  });

  it('still accepts the legacy boolean third argument', () => {
    expect(stallExhaustedNotice('m', [], true)).toContain('returned an empty turn');
    expect(stallExhaustedNotice('m', [], false)).toContain('described tool calls');
    expect(modelFailoverNotice('a', 'b', true)).toContain('returned an empty turn');
    expect(modelFailoverNotice('a', 'b', 'handed-off')).toContain('handed the remaining work back');
  });
});
