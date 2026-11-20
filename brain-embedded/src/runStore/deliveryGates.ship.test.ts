import { describe, expect, it } from 'vitest';
import { DEFAULT_SHIP_POLICY, shipPolicyOf, type ShipPolicy } from '@builderforce/run-guards';
import type { BrainRunContext } from './brainRunContext';
import { deliveryGates } from './deliveryGates';
import { PendingCalls } from './pendingCalls';

/** PRD 48: `brain.ship` fires only when the run's policy ships something and nothing shipped. */
const IDE = ['edit_file', 'run_command', 'git_status', 'git_diff', 'git_commit', 'git_push'];

function runCtx(shipPolicy: ShipPolicy): BrainRunContext {
  return {
    c: { codeChanged: true, touchedFiles: ['src/a.ts'], trace: [{ ts: '', category: 'tool', label: 'edit_file', args: { path: 'src/a.ts' } }], runTraceFrom: 0 },
    catalogToolNames: IDE,
    userRequest: 'fix the deep link',
    priorReply: null,
    publishHold: null,
    shipPolicy,
    shipRecoveryUsed: false,
    reviewRecoveryUsed: false,
    delegationRecoveryUsed: false,
    restateRecoveryUsed: false,
    pendingNarrationRecoveryUsed: false,
    pending: new PendingCalls(),
  } as unknown as BrainRunContext;
}

const shipGate = (run: BrainRunContext) => deliveryGates(run).find((g) => g.id === 'brain.ship')!;

describe('brain.ship (PRD 48)', () => {
  it('fires under a shipping policy and nudges by that policy', () => {
    const gate = shipGate(runCtx(DEFAULT_SHIP_POLICY));
    expect(gate.applies('I fixed it.')).toBe(true);
    expect(gate.nudge()).toMatch(/`commit`/);
    expect(gate.nudge()).toMatch(/do not push/);
  });

  it('stays quiet under leave_uncommitted — a project rule, a sub-agent or a hold', () => {
    for (const source of ['project_settings', 'subagent', 'chat_hold'] as const) {
      expect(shipGate(runCtx(shipPolicyOf('leave_uncommitted', source))).applies('I fixed it.'), source).toBe(false);
    }
  });
});
