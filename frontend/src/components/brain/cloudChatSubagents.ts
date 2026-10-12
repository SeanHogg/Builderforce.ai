import type { ChatSubagentVM } from '@seanhogg/builderforce-brain-ui';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isChatSubagentVM(row: unknown): row is ChatSubagentVM {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    isNonEmptyString(r.key) &&
    isNonEmptyString(r.handle) &&
    isNonEmptyString(r.name) &&
    isNonEmptyString(r.label) &&
    isNonEmptyString(r.owner)
  );
}

/**
 * Live cloud sub-agents from GET /chats/:id/runs.
 * The API adds `subagents` beside the run history. A failed fetch degrades to an
 * empty history WITHOUT that field — that is not "none running".
 */
export function runHistoryHasSubagents(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && Array.isArray((raw as { subagents?: unknown }).subagents);
}

export function asChatSubagents(raw: unknown): ChatSubagentVM[] {
  if (!runHistoryHasSubagents(raw)) return [];
  return (raw as { subagents: unknown[] }).subagents.filter(isChatSubagentVM);
}
