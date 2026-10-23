/**
 * THE specialist job registry (cost lever E2) — data, not branches.
 *
 * A specialist is a small, cheap model admitted for ONE narrow job. Each row names
 * the job, the candidate models the weekly sweep (`evalSweep.ts`) tries, the frontier
 * model whose output is the reference, how a candidate's output is scored against
 * that reference, and the size of the held-out eval set. Admission is the shared
 * frontier-parity rule (`admission.ts`): ≥ {@link FRONTIER_PARITY_BAR} of the frontier
 * score on the same cases. A job with no admitted model is served exactly as today.
 *
 * Candidates are Workers AI small instruct models from the live Cloudflare catalog
 * (`vendors/cloudflare.ts`). A bfi-served local model is not a candidate here: the
 * Worker cannot reach a host's local engine, so local specialists stay a host-side
 * decision.
 *
 * Commit / PR message generation is NOT a job: no model writes them on the server —
 * `agentCommitMessage` (runtime/cloudAgent/prd.ts) and `buildPrBody`
 * (repos/prDispatch.ts) are templates, so there is no model call to replace.
 */

import { ACTION_TYPES } from '@builderforce/learned-routing';
import { FRONTIER_PARITY_BAR } from './admission';

export type SpecialistJobId = 'compaction_summary' | 'task_action_type';

/**
 * How a candidate's output is scored against the frontier reference:
 *   • `label` — the job's output is a closed label; the score is agreement with the
 *     frontier's label (the frontier scores 1 on its own labels by construction).
 *   • `judge` — free text; ONE pinned judge rates the frontier's and the candidate's
 *     output on each case against the case's own instruction and input, and the two
 *     means are compared.
 */
export type SpecialistScorer =
  | { kind: 'label'; labelOf: (output: string) => string | null }
  | { kind: 'judge' };

export interface SpecialistJob {
  id: SpecialistJobId;
  summary: string;
  /** Catalog ids the sweep evaluates, cheapest first. */
  candidates: readonly string[];
  /** The frontier model whose output is each case's reference (and the judge). */
  referenceModel: string;
  scorer: SpecialistScorer;
  evalSet: {
    /** Fewer referenced cases than this ⇒ no verdict (existing admissions stand). */
    minCases: number;
    /** Capture stops at this many cases; the sweep scores at most this many. */
    maxCases: number;
    /** Share (0..1) of the job's calls whose input is captured until the set is full. */
    captureRate: number;
  };
  /** Override of the parity bar — absent = {@link FRONTIER_PARITY_BAR}. */
  bar?: number;
}

/** The frontier reference for every job today: one model, so references and judge
 *  verdicts are comparable across jobs. */
const FRONTIER_REFERENCE_MODEL = 'claude-sonnet-5';

const ACTION_TYPE_SET: ReadonlySet<string> = new Set(ACTION_TYPES);

/** The classifier's `{ action_type }` JSON → its label, or null when it is not one. */
export function actionTypeLabel(output: string): string | null {
  const match = output.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const value = (JSON.parse(match[0]) as { action_type?: unknown }).action_type;
    return typeof value === 'string' && ACTION_TYPE_SET.has(value) ? value : null;
  } catch {
    // Not JSON — an unparseable answer has no label, which scores as a miss.
    return null;
  }
}

export const SPECIALIST_JOBS: readonly SpecialistJob[] = [
  {
    id: 'compaction_summary',
    summary: 'Compress the dropped middle of a coding-agent transcript into a memory note (compactMessages).',
    candidates: ['@cf/meta/llama-3.1-8b-instruct-fp8', '@cf/google/gemma-4-26b-a4b-it', '@cf/qwen/qwen3-30b-a3b-fp8'],
    referenceModel: FRONTIER_REFERENCE_MODEL,
    scorer: { kind: 'judge' },
    evalSet: { minCases: 12, maxCases: 25, captureRate: 0.2 },
  },
  {
    id: 'task_action_type',
    summary: 'Ticket action-type classification when the lexical classifier is not confident (classifyTask).',
    candidates: ['@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.1-8b-instruct-fp8'],
    referenceModel: FRONTIER_REFERENCE_MODEL,
    scorer: { kind: 'label', labelOf: actionTypeLabel },
    evalSet: { minCases: 20, maxCases: 40, captureRate: 0.5 },
  },
];

const BY_ID: ReadonlyMap<SpecialistJobId, SpecialistJob> = new Map(SPECIALIST_JOBS.map((j) => [j.id, j]));

export function specialistJob(id: SpecialistJobId): SpecialistJob {
  const job = BY_ID.get(id);
  if (!job) throw new Error(`unknown specialist job: ${id}`);
  return job;
}

/** The bar a job's admissions are held to. */
export function specialistBar(job: SpecialistJob): number {
  return job.bar ?? FRONTIER_PARITY_BAR;
}
