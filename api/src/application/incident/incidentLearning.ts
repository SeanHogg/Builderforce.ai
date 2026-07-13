/**
 * incidentLearning — feed a resolved incident's lesson into the project's Evermind
 * model so the agent workforce LEARNS from incidents and stops repeating the actions
 * that cause them.
 *
 * On post-mortem, we distil the incident (root cause / what-went-wrong / resolution)
 * into a compact lesson and contribute it to the project's Evermind via the unified
 * text-learn producer (`dispatchProjectEvermindLearnText`). The `prompt` is phrased as
 * a task query about the affected system, because that is what Evermind recall matches
 * against at run time — so a future coding/incident run touching the same system
 * retrieves "we caused an incident doing X; avoid it".
 *
 * Best-effort and project-scoped: no-op when there is no projectId or the project's
 * Evermind is unseeded/frozen (the dispatcher + coordinator DO gate that). Never throws
 * — a learning failure must not fail the post-mortem.
 */
import { dispatchProjectEvermindLearnText } from '../llm/projectEvermind';
import type { Env } from '../../env';

/** Map incident severity to a learn weight — a worse incident teaches harder. */
function severityWeight(severity: string): number {
  switch (severity) {
    case 'sev1': return 3;
    case 'sev2': return 2;
    default: return 1;
  }
}

export interface IncidentLearningInput {
  projectId: number | null;
  title: string;
  severity: string;
  affectedSystem: string | null;
  rootCause: string | null;
  whatWentWrong?: string | null;
  resolution?: string | null;
}

/**
 * Record one incident lesson into the project's Evermind. Returns true when a learn
 * was dispatched (project + env present), false when skipped. Never throws.
 */
export async function recordIncidentLearning(env: Env | undefined, tenantId: number, input: IncidentLearningInput): Promise<boolean> {
  if (!env || input.projectId == null) return false;
  const system = input.affectedSystem ?? 'this system';
  const lesson = [
    `Incident: ${input.title} (${input.severity}${input.affectedSystem ? `, ${input.affectedSystem}` : ''}).`,
    input.rootCause ? `Root cause / action that caused it: ${input.rootCause}.` : '',
    input.whatWentWrong ? `What went wrong: ${input.whatWentWrong}.` : '',
    input.resolution ? `Resolution: ${input.resolution}.` : '',
    `Lesson: avoid repeating the cause above when working on ${system}.`,
  ].filter(Boolean).join(' ');
  const prompt = `Working on ${system}: what past incident should I avoid repeating?`;
  try {
    await dispatchProjectEvermindLearnText(env, tenantId, input.projectId, lesson, severityWeight(input.severity), prompt);
    return true;
  } catch {
    return false;
  }
}
