/**
 * compileStage — PURE: turn a swimlane + its ordered agent assignments into a
 * list of workflow-task specs the workflow engine can consume.
 *
 * No IO. The coordinator loads a swimlane and its assignments from the DB and
 * calls this to produce the {agentRole, description, dependsOn} graph that gets
 * inserted as workflow_tasks rows.
 */

/** Runtime tiers an assignment can target. */
export type AssignmentRuntime = 'local' | 'cloud' | 'remote' | 'browser';

/** A single agent assignment within a swimlane (subset of the DB row we need). */
export interface StageAssignment {
  /** Stable id of the assignment row (used to make descriptions unique). */
  id: string;
  /** Agent role/persona, e.g. 'implementer', 'reviewer'. */
  role: string;
  /** Where this agent runs. */
  runtime: AssignmentRuntime;
  /** Remote agentHost id / routing target — required when runtime is 'remote'. */
  target?: string | null;
  /** Optional human task template; falls back to a generated description. */
  taskTemplate?: string | null;
  /** Ordering within the stage (used for sequential dependency chaining). */
  position: number;
}

/** A compiled workflow-task spec. */
export interface WorkflowTaskSpec {
  /** Synthetic id for this spec, used to wire dependsOn between specs. */
  id: string;
  /**
   * The agent role, with the runtime encoded as a prefix:
   *  - 'local'  → '<role>'              (runs on the local agentHost)
   *  - 'cloud'  → 'remote:<target|cloud>'  (cloud is a remote dispatch)
   *  - 'remote' → 'remote:<target>'     (explicit remote agentHost)
   */
  agentRole: string;
  /** Human-readable, GUARANTEED-UNIQUE task description. */
  description: string;
  /** Ids (within this list) this task depends on. parallel → empty. */
  dependsOn: string[];
}

/** Execution mode for a stage. */
export type ExecutionMode = 'parallel' | 'sequential';

/**
 * Encode the runtime into the agentRole prefix.
 * 'cloud' and 'remote' both become a `remote:<target>` dispatch role; 'local'
 * stays a bare role. For 'cloud' with no explicit target we use 'cloud' as the
 * routing target placeholder.
 */
export function encodeAgentRole(role: string, runtime: AssignmentRuntime, target?: string | null): string {
  const trimmedRole = role.trim();
  if (runtime === 'local') return trimmedRole;
  // The browser tier is a PULL runtime: a browser worker claims the dispatch and
  // runs the agent loop client-side. Encode it distinctly from agentHost `remote:`.
  if (runtime === 'browser') {
    const browserTarget = (target ?? '').trim() || 'browser';
    return `browser:${browserTarget}:${trimmedRole}`;
  }
  const resolvedTarget = (target ?? '').trim() || (runtime === 'cloud' ? 'cloud' : '');
  if (!resolvedTarget) {
    // A 'remote' runtime with no target is malformed; fall back to a marker so
    // the caller can detect/route it rather than silently producing a bare role.
    return `remote:unassigned:${trimmedRole}`;
  }
  return `remote:${resolvedTarget}:${trimmedRole}`;
}

/**
 * Compile a swimlane stage into ordered workflow-task specs.
 *
 * @param assignments agent assignments for the swimlane (any order; sorted here)
 * @param mode        'parallel' → all specs have empty dependsOn;
 *                    'sequential' → each spec depends on the previous one.
 * @param stageKey    swimlane key, used to namespace descriptions for uniqueness.
 */
export function compileStage(
  assignments: readonly StageAssignment[],
  mode: ExecutionMode,
  stageKey: string,
): WorkflowTaskSpec[] {
  const ordered = [...assignments].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.id.localeCompare(b.id);
  });

  const seenDescriptions = new Set<string>();
  const specs: WorkflowTaskSpec[] = [];

  ordered.forEach((assignment, index) => {
    const agentRole = encodeAgentRole(assignment.role, assignment.runtime, assignment.target);

    const base = (assignment.taskTemplate?.trim())
      || `${assignment.role.trim()} stage work for ${stageKey}`;

    // Guarantee uniqueness: namespace by stage + ordinal, then de-dupe on collision.
    let description = `[${stageKey}#${index + 1}] ${base}`;
    let suffix = 1;
    while (seenDescriptions.has(description)) {
      suffix += 1;
      description = `[${stageKey}#${index + 1}] ${base} (${suffix})`;
    }
    seenDescriptions.add(description);

    const prev = index > 0 ? ordered[index - 1] : undefined;
    const dependsOn = mode === 'sequential' && prev ? [prev.id] : [];

    specs.push({
      id: assignment.id,
      agentRole,
      description,
      dependsOn,
    });
  });

  return specs;
}
