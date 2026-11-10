/**
 * PRD 45 A4 parity — replay chat #214's unshipped change through the REAL `startRun`,
 * with FAKE host ports bound (the VSIX `clients/vscode/src/verify/` is the reference
 * host; here the harness binds its own fakes). The stored-record scenarios (`ends.ts`,
 * `review.ts`, …) bind NO ports and pass unchanged; this scenario is run by its own
 * test (`gates.test.ts`), not the snapshot suite — its ports make its record one the
 * old loop never produced.
 *
 * #214 measured: 6 new source files, 0 tests; a `git commit && git push` straight from
 * the shell; the author recording its own review; the ticket then marked done — with
 * nothing verified and nobody independent. The gates must refuse each step:
 *   1. git_push (base branch)          → REFUSED — the new source file has no test.
 *   2. run_command "git commit && git push" → the shell-publish hint points at the
 *      gated tools (advisory; the gate catches the shell commit at push).
 *   3. the next git_push               → still REFUSED (the bytes are unchanged).
 *   4. builtin_reviews_record complete → REFUSED — no reviewGate-approved review.
 *   5. builtin_tasks_update done       → the existing branch guard already refuses
 *      (code is not on the base branch); the outgoing-gate advisory rides the result.
 */

import { calls, call, reply, PINNED } from '../script';
import type { Scenario } from '../types';
import { runOutgoingGate, shipGateRefusal, shipGateAdvisory } from '../../../runStore/shipGates';
import type { BrainRunContext } from '../../../runStore/brainRunContext';
import type { GitPort, ReviewerPort, VerifierPort } from '../../../runStore/runTypes';
import type { CheckRecord } from '@builderforce/run-guards';

const NEW_FILE = 'agent-runtime/extensions/a2a/src/inbound.ts';

/** The fake git port: one new source file still on the base branch, never pushed. */
const gitPort = (): GitPort => ({
  async outgoing() {
    return {
      files: [{ absPath: NEW_FILE, hash: 'hash-1', isNew: true, deleted: false }],
      diffHash: 'diff-1',
      baseBranch: true,
    };
  },
});

/** The fake verifier: the full tier runs nothing here (no test exists for the new file). */
const verifierPort = (): VerifierPort => ({
  async diagnostics() { return null; },
  async full(absPaths: readonly string[]) {
    const m = new Map<string, readonly CheckRecord[]>();
    for (const p of absPaths) m.set(p, []);
    return m;
  },
});

/** The fake reviewer: nobody independent is available (OD-1) — refuses with guidance. */
const reviewerPort = (): ReviewerPort => ({
  async review() {
    return { refused: 'No independent reviewer is available on this host.' };
  },
});

export const gates: Scenario = {
  id: 'gates',
  rows: ['PRD45-A4'],
  title: 'chat #214 replayed with fake ports: push refused (no test), shell publish hinted, re-push refused, complete review refused, done refused',
  async run(h) {
    // The publish tools are fakes the harness "runs"; the gates sit in the preflight.
    h.tools({
      edit_file: () => ({ ok: true }),
      run_command: () => ({ ok: true, output: 'committed and pushed' }),
      git_commit: () => ({ ok: true, commit: 'abc123' }),
      git_push: () => ({ ok: true, action: 'push' }),
      builtin_reviews_record: () => ({ ok: true, reviewId: 1 }),
      builtin_tasks_update: () => ({ ok: true }),
    });
    // ONE run, as #214 was: a prose reply ends a run, so the steps are consecutive tool
    // turns and the only reply is the last.
    h.script([
      calls([call('edit_file', { path: NEW_FILE, old_string: 'a', new_string: 'b' }, 'e1')]),
      // Step 1: the base-branch push is refused — the new file has no test.
      calls([call('git_push', { allowBaseBranch: true }, 'g1')]),
      // Step 2: the model tries to publish straight from the shell; the hint points at
      // the gated tools (advisory only — the gate catches the shell commit at push).
      calls([call('run_command', { command: 'git commit -am x && git push' }, 'r1')]),
      // Step 3: the next git_push is STILL refused — the bytes are unchanged.
      calls([call('git_push', { allowBaseBranch: true }, 'g2')]),
      // Step 4: the author tries to record its own review as complete — refused.
      calls([call('builtin_reviews_record', { taskId: 101, verdict: 'complete', summary: 'looks good' }, 'rv1')]),
      // Step 5: the ticket is marked done — refused while the change is unshipped.
      calls([call('builtin_tasks_update', { id: 101, status: 'done' }, 't1')]),
      reply('I cannot mark it done until the change ships: the push needs a test and an independent review.'),
    ]);
    await h.start({
      ...PINNED,
      projectId: 11,
      userTurn: 'add the inbound handler and ship it',
      git: gitPort(),
      verifier: verifierPort(),
      reviewer: reviewerPort(),
    });
  },
};

/** The pure-gate half, asserted directly (no run needed). */
export async function assertGates(run: BrainRunContext): Promise<string[]> {
  const problems: string[] = [];
  const refuse = await shipGateRefusal(run, 'git_push', { allowBaseBranch: true });
  if (refuse?.ok !== false || !/no test/.test(refuse.error)) {
    problems.push(`git_push should refuse (no test), got ${JSON.stringify(refuse)}`);
  }
  const shell = await shipGateAdvisory(run, 'run_command', { command: 'git commit && git push' }, { ok: true });
  if (typeof shell !== 'string' || !/git_push/.test(shell)) {
    problems.push(`run_command should hint at git_push, got ${JSON.stringify(shell)}`);
  }
  const review = await shipGateRefusal(run, 'builtin_reviews_record', { taskId: 1, verdict: 'complete' });
  if (review?.ok !== false || !/review/i.test(review.error)) {
    problems.push(`complete review should refuse without a reviewer, got ${JSON.stringify(review)}`);
  }
  const gate = await runOutgoingGate(run, '');
  if (gate.verdict.ok) problems.push('runOutgoingGate should refuse (no test)');
  return problems;
}
