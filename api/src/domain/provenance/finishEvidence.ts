export interface ToolEvidenceCandidate {
  toolName: string;
  category: string | null;
  result: string | null;
}

/** Tool events that can support a code-completion claim. Planning/model/message
 * events describe intent; only an executed mutation or verification is evidence. */
export function supportsCodeCompletion(candidate: ToolEvidenceCandidate): boolean {
  if (candidate.category !== 'tool') return false;
  if (/^(write_file|edit_file|delete_file|run_checks|run_command|git_)/.test(candidate.toolName) === false) return false;
  const result = candidate.result?.toLowerCase() ?? '';
  return !result.includes('"ok":false') && !result.startsWith('blocked ') && !result.includes(' refused');
}
