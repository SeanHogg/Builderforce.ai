/**
 * THE cloud agent commit-subject convention, in one place: the subject every cloud write
 * lands under, the marker that proves a commit is a given run's, and the parse back to the
 * one path a commit touched.
 *
 *   `<Verb> <path> — task #<taskId> · run #<executionId> (<agent>)<suffix>`
 *
 * PER RUN (PRD 41 §D1, WS16). The subject used to carry the TASK only (`— task #12 (Coder)`),
 * so a retry or a child run on the same ticket branch could not be told apart from this run —
 * the per-task authorship defect in the ROADMAP gap register. It now carries the execution as
 * well, and {@link runCommitMarker} with an execution id matches exactly one run's commits.
 * A commit written before this change carries no `· run #`, so it never matches a per-run
 * marker and reads as FOREIGN to a teardown — a refusal, the safe side. A REVERT accepts it
 * only when the run is ENTIRELY legacy (none of the branch's commits carries the per-run
 * marker) and the rollback snapshot recorded that exact sha (`legacyRunCommitMarker` in
 * `branchTeardownDecision`), so a run snapshotted before per-run subjects stays revertable.
 * Such a run is still ambiguous: the snapshot records every commit ahead of base on the shared
 * task branch, so its legacy commits cannot be told apart from an earlier legacy run's on the
 * same branch — rule 8 (branch not advanced past the recorded shas) is the only guard.
 *
 * Pure: no I/O.
 */

/**
 * The substring every commit of a run carries. With `executionId`, per RUN
 * (`— task #12 · run #345 (`); without, the legacy per-TASK marker (`— task #12 (`), which
 * matches only commits written before per-run subjects.
 */
export function runCommitMarker(taskId: number, executionId?: number): string {
  return executionId === undefined ? `— task #${taskId} (` : `— task #${taskId} · run #${executionId} (`;
}

/** Which run wrote a commit. */
export interface AgentCommitRun {
  taskId: number;
  executionId: number;
}

/** The commit subject a run's own write lands under. */
export function agentCommitSubject(verb: string, path: string, run: AgentCommitRun, agentLabel: string, suffix = ''): string {
  return `${verb} ${path} ${runCommitMarker(run.taskId, run.executionId)}${agentLabel})${suffix}`;
}

/**
 * The verb and the one path an agent commit touched, read back from its subject, or null when
 * the message does not carry `marker` or has no `<Verb> <path>` before it. Only the first line
 * is read (a provider may append a body).
 */
export function parseAgentCommitSubject(message: string, marker: string): { verb: string; path: string } | null {
  const subject = message.split('\n', 1)[0] ?? '';
  const at = subject.indexOf(` ${marker}`);
  if (at <= 0) return null;
  const head = subject.slice(0, at);
  const space = head.indexOf(' ');
  if (space <= 0) return null;
  const path = head.slice(space + 1).trim();
  return path.length > 0 ? { verb: head.slice(0, space), path } : null;
}
