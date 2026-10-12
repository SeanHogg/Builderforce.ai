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
 * The API adds `subagents` beside the run history; the rest adapter's type does not
 * name that field yet, so we read it off the JSON at runtime.
 */
export function asChatSubagents(raw: unknown): ChatSubagentVM[] {
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as { subagents?: unknown }).subagents;
  if (!Array.isArray(list)) return [];
  return list.filter(isChatSubagentVM);
}
