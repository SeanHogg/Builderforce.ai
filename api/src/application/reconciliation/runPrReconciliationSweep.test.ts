import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./runPrReconciliationSweep.ts', import.meta.url).href), 'utf8');

describe('scheduled PR reconciliation policy wiring', () => {
  it('runs audited apply mode with only the internal close-candidate policy enabled', () => {
    expect(source).toContain("mode: 'apply'");
    expect(source).toContain('autoApplyCloseCandidates: true');
  });

  it('does not let a recent diagnostic dry run postpone the first cleanup run', () => {
    expect(source).toContain("recent.mode = 'apply'");
  });

  it('does not let a run from an older reconciliation policy postpone rollout', () => {
    expect(source).toContain("recent.summary ->> 'policyVersion'");
    expect(source).toContain('PR_RECONCILIATION_POLICY_VERSION');
  });

  it('uses a sub-tick overlap lease instead of suppressing a repository for a day', () => {
    expect(source).toContain('4 * 60 * 1_000');
    expect(source).not.toContain('23 * 60 * 60');
  });

  it('backs off repeated GitHub authorization failures instead of retrying every cron tick', () => {
    expect(source).toContain("failure.details ->> 'status' = '403'");
    expect(source).toContain('6 * 60 * 60 * 1_000');
  });
});

describe('scheduled PR reconciliation GitHub throttle back-off', () => {
  it('skips a credential while GitHub has it cooled down, via the shared cooldown helper', () => {
    expect(source).toContain('activeGithubCooldown(env, credentialKey)');
    expect(source).toContain('recordGithubCooldown(env, credentialKey');
  });

  it('reports a refused credential once as a warning rather than an error every tick', () => {
    // The cooldown branch reports ONCE at warning level and skips the error report
    // below it; cooled ticks never reach this branch at all.
    const catchBlock = source.slice(source.indexOf('githubCooldownFor(error)'));
    const cooldownBranch = catchBlock.slice(0, catchBlock.indexOf('continue;'));
    expect(cooldownBranch).toContain("level: 'warning'");
    expect(cooldownBranch).toContain('recordGithubCooldown(');
  });
});
