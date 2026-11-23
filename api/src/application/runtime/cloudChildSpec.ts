/** Durable child identity and prompt data. This module owns no database or runner I/O. */
import type { ModelRole } from '@builderforce/agent-tools';
import { prepareChildStart } from '@builderforce/agent-run';
import type { EntryPoint } from '@builderforce/learned-routing';
import { parseJsonObject } from '../../domain/shared/json';

/** The payload key a child's spec rides under. */
const SPEC_KEY = 'subagent';

/** The spawn budget bounds ordinary fan-out. Row readers also cap unexpected fan-out. */
export const MAX_CHILD_ROWS = 200;

/** Everything a child execution needs to know about itself, carried on its payload. */
export interface CloudChildSpec {
  /** Persisted at admission; optional only for executions admitted before shared spawning. */
  standingPrompt?: string;
  entryPoint?: EntryPoint;
  /** Ticket refs scoped by the parent before admission. */
  workItemIds?: readonly string[];
  parentExecutionId: number;
  /** The run at the top of its tree — the one its tokens bill to and that opens the PR. */
  rootExecutionId: number;
  /** 1 for a child, 2 for a grandchild … (spawning stops at `MAX_SUBAGENT_DEPTH`). */
  depth: number;
  /** How its owner addresses it (`message_agent`, `stop_agent`, reports). */
  handle: string;
  label: string;
  task: string;
  role?: ModelRole;
  /** Who it runs as — resolved by the parent at spawn, so the child never re-resolves. */
  persona?: { name: string; brief: string };
  asAgent?: { ref: string; name: string };
  staffing?: string;
  ticket?: string;
  /** Its owner's display name, for the brief and for direction it reads. */
  owner: string;
}

/** A child's handle is its execution id — unique, stateless, and parseable back. */
export const childHandle = (executionId: number): string => `a${executionId}`;
export function childIdOf(handle: string): number | null {
  const m = /^a(\d+)$/.exec(handle.trim());
  return m ? Number(m[1]) : null;
}

export function parseCloudChild(payload: string | null | undefined): CloudChildSpec | null {
  if (!payload) return null;
  try {
    const spec = (JSON.parse(payload) as Record<string, unknown>)[SPEC_KEY] as CloudChildSpec | undefined;
    return spec && typeof spec.parentExecutionId === 'number' && typeof spec.task === 'string' ? spec : null;
  } catch {
    return null;
  }
}

/** Whether a run is someone's sub-agent — a slice of its parent's run, never a run of its own. */
export const isSubagentRun = (payload: string | null | undefined): boolean => parseCloudChild(payload) !== null;

/** The child's payload: its owner's routing (chat, agent, model, gates) and its own spec. */
export function childPayload(parentPayload: string | undefined, spec: CloudChildSpec): string {
  // An unreadable parent payload just carries nothing forward.
  const parent = parseJsonObject(parentPayload);
  // Only what routes and governs the run is inherited. A parent's follow-up directive,
  // role instruction or review sign-off is ITS job, not the child's.
  const inherited = Object.fromEntries(
    ['chatId', 'cloudAgentRef', 'model', 'policyGates', 'routingBias'].filter((k) => k in parent).map((k) => [k, parent[k]]),
  );
  // `lifecycleNeutral`: a child never moves the ticket or speaks for a managed stage.
  return JSON.stringify({ ...inherited, executor: 'durable', lifecycleNeutral: true, [SPEC_KEY]: spec });
}

/** Update lineage metadata on the admitted payload, preserving all admission stamps. */
export function withCloudChildHandle(admittedPayload: string | null, handle: string): string {
  const spec = parseCloudChild(admittedPayload);
  if (!spec) throw new Error('Admitted execution is missing its child spec');
  return JSON.stringify({ ...parseJsonObject(admittedPayload), executor: 'durable', [SPEC_KEY]: { ...spec, handle } });
}

/** The child's prompt and first turn — the sub-agent brief in front of its owner's prompt. */
export function childBrief(spec: CloudChildSpec, basePrompt: string): { systemPrompt: string; userContent: string } {
  const standing = spec.standingPrompt ?? prepareChildStart({
    parentRunId: String(spec.parentExecutionId), entryPoint: spec.entryPoint ?? 'cloud',
    depth: spec.depth, owner: spec.owner, task: spec.task, role: spec.role, persona: spec.persona,
  }).systemPrompt;
  return { systemPrompt: `${standing}\n\n${basePrompt}`, userContent: spec.task };
}

