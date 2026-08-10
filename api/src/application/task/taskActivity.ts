export interface TaskExecutionActivityInput {
  id: number;
  agentRef: string | null;
  payload: string | null;
  status: string;
  produced: boolean | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface TaskFileActivityInput {
  executionId: number;
  path: string;
}

export interface TaskActivitySummary {
  executionsCount: number;
  executionsTruncated: boolean;
  lastExecutionAt: string | null;
  lastExecutionAgentRef: string | null;
  lastExecutionRole: string | null;
  lastExecutionProducedCode: boolean;
  lastCoderRunProducedCode: boolean;
  lastCoderExecutionAt: string | null;
  pullRequestActor: {
    executionId: number;
    agentRef: string | null;
    role: string | null;
    at: string;
    inferred: true;
  } | null;
  staleImplementation: boolean;
  staleReason: string | null;
}

const DOC_PATH = /(^|\/)(prd\.md|readme\.md|roadmap\.md|done\.md)$|(^|\/)(specs|docs)(\/|$)|\.mdx?$/i;
const CODER_ROLE = /(^|[-_])(coder|developer|engineer)([-_]|$)/i;

export function executionRole(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    for (const key of ['actAsRole', 'roleKey', 'role']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch {
    return null;
  }
  return null;
}

export function isCodePath(path: string): boolean {
  return !DOC_PATH.test(path.replace(/\\/g, '/'));
}

export function summarizeTaskActivity(
  taskStatus: string,
  executions: TaskExecutionActivityInput[],
  fileChanges: TaskFileActivityInput[],
  hasPullRequest: boolean,
  options: { executionsCount?: number; hasCoderCodeEver?: boolean } = {},
): TaskActivitySummary {
  const filesByExecution = new Map<number, string[]>();
  for (const change of fileChanges) {
    const paths = filesByExecution.get(change.executionId) ?? [];
    paths.push(change.path);
    filesByExecution.set(change.executionId, paths);
  }

  const ordered = [...executions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const codeExecutions = ordered.filter((execution) =>
    (filesByExecution.get(execution.id) ?? []).some(isCodePath));
  const coderExecutions = ordered.filter((execution) => CODER_ROLE.test(executionRole(execution.payload) ?? ''));
  const coderCodeExecutions = coderExecutions.filter((execution) =>
    (filesByExecution.get(execution.id) ?? []).some(isCodePath));
  const last = ordered[0] ?? null;
  const lastCoder = coderExecutions[0] ?? null;
  const deliveryActor = codeExecutions[0] ?? ordered.find((execution) =>
    (filesByExecution.get(execution.id) ?? []).length > 0) ?? null;
  const terminalReview = taskStatus === 'in_review' || taskStatus === 'done';
  const coderCodeExists = options.hasCoderCodeEver ?? coderCodeExecutions.length > 0;
  const executionsCount = options.executionsCount ?? ordered.length;
  const staleImplementation = terminalReview && !coderCodeExists;

  return {
    executionsCount,
    executionsTruncated: executionsCount > ordered.length,
    lastExecutionAt: last ? (last.completedAt ?? last.createdAt).toISOString() : null,
    lastExecutionAgentRef: last?.agentRef ?? null,
    lastExecutionRole: last ? executionRole(last.payload) : null,
    lastExecutionProducedCode: last
      ? (filesByExecution.get(last.id) ?? []).some(isCodePath)
      : false,
    lastCoderRunProducedCode: lastCoder
      ? (filesByExecution.get(lastCoder.id) ?? []).some(isCodePath)
      : false,
    lastCoderExecutionAt: lastCoder ? (lastCoder.completedAt ?? lastCoder.createdAt).toISOString() : null,
    pullRequestActor: hasPullRequest && deliveryActor ? {
      executionId: deliveryActor.id,
      agentRef: deliveryActor.agentRef,
      role: executionRole(deliveryActor.payload),
      at: (deliveryActor.completedAt ?? deliveryActor.createdAt).toISOString(),
      inferred: true,
    } : null,
    staleImplementation,
    staleReason: staleImplementation
      ? 'Task is in review or Done, but no coder/developer/engineer execution produced a non-documentation file.'
      : null,
  };
}
