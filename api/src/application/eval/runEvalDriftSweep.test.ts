import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ raise: vi.fn(async () => 'raised'), report: vi.fn() }));
vi.mock('../alerts/systemAlert', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../alerts/systemAlert')>()),
  raiseSystemAlert: mocks.raise,
}));
vi.mock('./driftReport', () => ({ buildTenantDriftReport: mocks.report }));
vi.mock('../shared/runTelemetryDatabase', () => ({ runTelemetryDatabase: (db: unknown) => db }));

import { buildEvalDriftAlertMessage, EVAL_DRIFT_ALERT_COOLDOWN_HOURS, runEvalDriftSweep } from './runEvalDriftSweep';

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

describe('runEvalDriftSweep', () => {
  const tenantsDb = (ids: number[]) => {
    const chain = {
      select: () => chain, from: () => chain, where: () => chain,
      groupBy: async () => ids.map((tenantId) => ({ tenantId })),
    };
    return chain as never;
  };
  const drifting = [{ group: 'docs:m', samples: 30, result: { severity: 'alert', delta: -0.2, zScore: -3, psi: 0.4 } }];

  it('raises drift through THE system-alert raiser, with its cooldown', async () => {
    mocks.raise.mockClear();
    mocks.report.mockResolvedValue({ drifting });
    await runEvalDriftSweep({} as never, tenantsDb([4]));
    expect(mocks.raise).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({
      tenantId: 4,
      metric: 'eval_drift',
      observedValue: 1,
      cooldownHours: EVAL_DRIFT_ALERT_COOLDOWN_HOURS,
      message: buildEvalDriftAlertMessage(drifting),
    }));
  });

  it('raises nothing for a tenant with no drift', async () => {
    mocks.raise.mockClear();
    mocks.report.mockResolvedValue({ drifting: [] });
    await runEvalDriftSweep({} as never, tenantsDb([4]));
    expect(mocks.raise).not.toHaveBeenCalled();
  });
});
