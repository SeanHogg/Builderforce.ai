/**
 * PRD 45 A4 — chat #214 replayed through the REAL `startRun` with fake host ports
 * (`scenarios/gates.ts`). Not in the snapshot suite: its ports make a record the old loop
 * never produced, so it is judged here on what the gates must do.
 */
import { describe, expect, it } from 'vitest';
import { createEvidenceLedger } from '@builderforce/run-guards';
import { runScenario } from './harness';
import { gates, assertGates } from './scenarios/gates';
import type { BrainRunContext } from '../../runStore/brainRunContext';
import type { GitPort, ReviewerPort, VerifierPort } from '../../runStore/runTypes';

describe('PRD 45 A4: chat #214 through the ship gates', () => {
  it('refuses the push (no test), hints at the shell publish, refuses the re-push and the self-recorded review', async () => {
    const record = await runScenario(gates);
    expect(record.scenarioError).toBeUndefined();
    const ran = record.host.toolCalls.map((t) => t.name);
    // The gates sit in the preflight: a refused call never reaches the host's runner.
    expect(ran).not.toContain('git_push');
    expect(ran).not.toContain('builtin_reviews_record');
    expect(ran).toContain('run_command');
    const wire = JSON.stringify(record.wire);
    // Steps 1 and 3: both pushes refused for the untested new file.
    expect(wire.match(/is new and has no test in this push/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // Step 2: the shell publish is pointed at the gated tools (advisory, not a refusal).
    expect(wire).toContain('That shell command publishes');
    // Step 4: the author's own `complete` review is refused.
    expect(wire).toContain('no reviewGate-approved independent review exists for the current diff');
  }, 60_000);

  it('the pure-gate half refuses each step on the same fake ports', async () => {
    const git: GitPort = { outgoing: async () => ({ files: [{ absPath: 'src/inbound.ts', hash: 'h', isNew: true, deleted: false }], diffHash: 'd', baseBranch: true }) };
    const verifier: VerifierPort = { diagnostics: async () => null, full: async (paths) => new Map(paths.map((p) => [p, []])) };
    const reviewer: ReviewerPort = { review: async () => ({ refused: 'No independent reviewer is available on this host.' }) };
    const run = {
      req: { git, verifier, reviewer },
      evidence: createEvidenceLedger(),
      c: { authorModels: new Set<string>(), shipReviews: [] },
    } as unknown as BrainRunContext;
    expect(await assertGates(run)).toEqual([]);
  });
});
