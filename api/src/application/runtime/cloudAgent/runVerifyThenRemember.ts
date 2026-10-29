/**
 * The cloud run's VERIFY-then-REMEMBER tail, out of `cloudAgentEngine.ts` so the engine
 * calls one function at run end instead of owning the verification and memory steps.
 */
import type { RunKnowledgeRecorder } from '@builderforce/agent-tools';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import type { CloudRunModelState } from './cloudRunModelPolicy';
import { commitRunMemory, describeVerifyOutcome, recordRunVerifyEvents, runVerifyPhase } from './runEndMemory';
import { runSandboxVerify, type VerifyShell } from '../sandbox/sandboxVerify';
import type { RunSandbox } from '../sandbox/runSandbox';

/**
 * The shared verify-then-remember tail, run from this file so it can move the run's
 * OWN policy state (only a host holding `modelState` can reduce it). Everything it
 * touches is best-effort by contract, so it is one call that cannot fail the run:
 *
 *  1. `runVerifyPhase` selects the verification verdict from what `onFinish` already
 *     ran (`ciVerified`), and `recordRunVerifyEvents` writes BOTH halves onto the
 *     timeline while returning the `verify_started` event for the reducer.
 *  2. The `verify_started` policy event is applied where the run actually VERIFIES —
 *     in `onFinish`, next to `verifyWrittenFiles`/`pollBranchCi` — because that is the
 *     only place the new phase can ride the live `modelState` into the turns a blocked
 *     finish forces. Applying it here, to a state this function only holds a COPY of
 *     and at the very end of the run, reduced it into a value nobody read. This tail
 *     asserts the phase rather than re-applying it.
 *  3. `commitRunMemory` writes the outcome into the governed memory the run already
 *     had as a capability. A failed write is reported and the run still finishes.
 */
export async function runVerifyThenRemember(args: {
  env: Env;
  db: Db;
  tenantId: number;
  projectId: number;
  executionId: number;
  taskRow: { id: number; title: string };
  agentLabel: string;
  cloudAgentRef?: string;
  writtenPaths: Set<string>;
  /** Content hash per written file (see `writtenFileHashes.ts`); anchors the run's facts to what it wrote. */
  writtenHashes?: ReadonlyMap<string, string>;
  runKnowledge: RunKnowledgeRecorder;
  finalOutput: string;
  ciVerified: boolean;
  modelState: CloudRunModelState;
  /** The run's sandbox and its shell (heartbeat + cancel), when it has one. */
  sandbox?: { sandbox: RunSandbox; shell: VerifyShell };
}): Promise<void> {
  const { env, db, tenantId, projectId, executionId, taskRow, agentLabel, cloudAgentRef, writtenPaths, finalOutput, ciVerified, modelState } = args;
  try {
    // With a sandbox the project's own declared checks run over the clone (honest exit
    // codes). Without one there is no shell, so the verification is the branch CI /
    // static check `onFinish` already ran — never a local typecheck/test that did not happen.
    const sandboxed = args.sandbox && writtenPaths.size > 0 ? await runSandboxVerify(args.sandbox.sandbox, args.sandbox.shell) : null;
    const outcome = sandboxed
      ? runVerifyPhase({ surface: 'sandbox', writtenPaths, packageScripts: sandboxed.packageScripts, runner: sandboxed.runner, results: sandboxed.results })
      : runVerifyPhase({
        surface: 'durable',
        writtenPaths,
        results: ciVerified ? [{ command: 'branch-ci', exitCode: 0 }] : null,
      });
    recordRunVerifyEvents({ db, tenantId, executionId, ...(cloudAgentRef ? { cloudAgentRef } : {}) }, outcome);
    // The `verify_started` POLICY event is applied where the run actually verifies —
    // in `onFinish`, next to `verifyWrittenFiles`/`pollBranchCi` — because only the
    // live `modelState` can carry the new phase into the turns a blocked finish
    // forces. Applying it to a `modelState` this function only holds a COPY of, at
    // the very end of the run, reduced the state into a value nobody read. Assert the
    // invariant instead of pretending to perform the transition: a run that reaches
    // here having verified must already be in the verify phase.
    if (modelState.policy.phase !== 'verify') {
      reportCaughtError(new Error(`run reached its verify tail still in the '${modelState.policy.phase}' phase`), {
        source: 'application/runtime/cloudAgent/runVerifyThenRemember.ts',
        operation: 'runVerifyThenRemember.assertVerifyPhase',
        context: { logMessage: '[cloud-run] verify phase was not applied before the run end', details: { tenantId, executionId, phase: modelState.policy.phase } },
      });
    }
    await commitRunMemory({
      db, env, tenantId, projectId, ticketId: taskRow.id, executionId,
      ...(cloudAgentRef ? { cloudAgentRef } : {}),
      summary: finalOutput?.trim() || `${agentLabel} finished ${taskRow.title}`,
      verifyNote: describeVerifyOutcome(outcome),
      writtenPaths: [...writtenPaths],
      ...(args.writtenHashes?.size ? { writtenFileHashes: Object.fromEntries(args.writtenHashes) } : {}),
      codeMap: args.runKnowledge.consolidate(),
    });
  } catch (error) {
    // Belt-and-braces: `commitRunMemory` swallows its own failures, but a defect in
    // the tail must still never cost this run its result.
    reportCaughtError(error, {
      source: 'application/runtime/cloudAgent/runVerifyThenRemember.ts',
      operation: 'runVerifyThenRemember',
      context: { logMessage: '[cloud-run] verify/remember tail failed; finishing without it', details: { tenantId, executionId, error } },
    });
  }
}
