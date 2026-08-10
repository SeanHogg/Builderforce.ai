export interface ToolEvidenceCandidate {
  toolName: string;
  category: string | null;
  result: string | null;
}

export type ExecutionClaimKind = 'code_completion' | 'validation' | 'review_verdict' | 'delivery' | 'human_message';

/** Tool events that can support a code-completion claim. Planning/model/message
 * events describe intent; only an executed mutation or verification is evidence. */
export function supportsCodeCompletion(candidate: ToolEvidenceCandidate): boolean {
  if (candidate.category !== 'tool') return false;
  if (/^(write_file|edit_file|delete_file|run_checks|run_command|git_)/.test(candidate.toolName) === false) return false;
  const result = candidate.result?.toLowerCase() ?? '';
  return !result.includes('"ok":false') && !result.startsWith('blocked ') && !result.includes(' refused');
}

export function supportsExecutionClaim(kind: ExecutionClaimKind, candidate: ToolEvidenceCandidate): boolean {
  const result = candidate.result?.toLowerCase() ?? '';
  if (result.includes('"ok":false') || result.includes('failed') || result.startsWith('blocked ') || result.includes(' refused')) return false;
  if (kind === 'code_completion') return supportsCodeCompletion(candidate);
  if (kind === 'validation') return candidate.category === 'tool' && /^(run_checks|run_command)$/.test(candidate.toolName);
  if (kind === 'review_verdict') return candidate.category === 'tool' && candidate.toolName === 'builtin_reviews_record';
  if (kind === 'delivery') return candidate.category === 'tool' && /^(pr_opened|pr_merged)$/.test(candidate.toolName);
  return candidate.category === 'message' && candidate.toolName === 'agent.message';
}
