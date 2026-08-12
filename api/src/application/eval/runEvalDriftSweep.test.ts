import { describe, expect, it } from 'vitest';
import { buildEvalDriftAlertMessage } from './runEvalDriftSweep';

describe('buildEvalDriftAlertMessage', () => {
  it('preserves each persisted model in the user-visible alert', () => {
    const message = buildEvalDriftAlertMessage([
      { group: 'backend_api:claude-opus-4-8', result: { severity: 'warn' } },
      { group: 'docs:@cf/zai-org/glm-4.7-flash', result: { severity: 'alert' } },
    ]);

    expect(message).toBe(
      'Eval drift detected on 2 groups: ' +
      'backend_api:claude-opus-4-8 (severity warn), ' +
      'docs:@cf/zai-org/glm-4.7-flash (severity alert).',
    );
    expect(message).not.toContain('unknown');
  });

  it('uses the singular label for one drifting group', () => {
    expect(buildEvalDriftAlertMessage([
      { group: 'tests:gpt-5.3-codex', result: { severity: 'warn' } },
    ])).toContain('detected on 1 group: tests:gpt-5.3-codex');
  });
});
