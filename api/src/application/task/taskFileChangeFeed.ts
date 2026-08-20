/**
 * taskFileChangeFeed — "what changed on this ticket", from EVERY executor.
 *
 * Two executors write a ticket's code and they record it differently:
 *
 *   - a headless agent host POSTs each edit to `/file-change`, so its changes are
 *     durable `task_file_changes` rows tied to an `executions` row; and
 *   - the browser/cloud worker has no execution row (a browser dispatch is an
 *     `agent_dispatches` row, not a run), so its changes ride its dispatch RESULT.
 *
 * The Changes tab used to read only the first, which is why a cloud-coded ticket
 * showed nothing to diff no matter how many files the run touched — the paths
 * existed only inside a prose summary. This composes both into one list so the
 * panel, the diff viewer and every other consumer keep asking ONE question.
 *
 * The dispatch side is a projection, not a second store: the branch itself is the
 * source of truth for content, and `GET /tasks/:taskId/file-content` reads it
 * back the same way for both executors.
 */
import { and, desc, eq } from 'drizzle-orm';
import { agentDispatches } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

/** The three kinds of change an agent records. */
export type FileChangeKind = 'created' | 'modified' | 'deleted';

/** One entry in the composed feed. `executionId` is null for dispatch-sourced rows. */
export interface TaskFileChangeEntry {
  path: string;
  change: FileChangeKind;
  agent: string;
  executionId: number | null;
  createdAt: Date;
  models: string[];
  modelUsage: Array<{ model: string; byo: boolean; provider: string | null }>;
}

/**
 * The structured result a non-host executor reports on `/result`. Only the fields
 * this projection needs are declared; the worker sends more (branch, PR) and the
 * card reads those from the dispatch row itself.
 */
interface DispatchResultPayload {
  files?: Array<{ path?: unknown; status?: unknown }>;
  changedFiles?: unknown;
}

function asKind(value: unknown): FileChangeKind {
  return value === 'created' || value === 'deleted' ? value : 'modified';
}

/**
 * Parse the changed files out of one dispatch's reported output.
 *
 * Tolerates the pre-structured form: an output that is not JSON (or carries no
 * file list) simply contributes nothing, so an old row degrades to "no diffs"
 * rather than throwing. Exported for unit tests — the wire shape is a contract
 * with the browser worker.
 */
export function parseDispatchChangedFiles(output: string | null): Array<{ path: string; change: FileChangeKind }> {
  if (!output?.trim().startsWith('{')) return [];
  let parsed: DispatchResultPayload;
  try {
    parsed = JSON.parse(output) as DispatchResultPayload;
  } catch {
    return [];
  }
  const out = new Map<string, FileChangeKind>();
  for (const f of parsed.files ?? []) {
    if (typeof f?.path === 'string' && f.path.trim()) out.set(f.path.trim(), asKind(f.status));
  }
  if (Array.isArray(parsed.changedFiles)) {
    for (const p of parsed.changedFiles) {
      if (typeof p === 'string' && p.trim() && !out.has(p.trim())) out.set(p.trim(), 'modified');
    }
  }
  return [...out].map(([path, change]) => ({ path, change }));
}

/**
 * The dispatch-sourced half of the feed: changed files reported by this task's
 * non-host dispatches, newest first. Tenant-scoped in the statement.
 */
export async function readDispatchFileChanges(
  db: Db,
  tenantId: number,
  taskId: number,
): Promise<TaskFileChangeEntry[]> {
  const rows = await db
    .select({
      role: agentDispatches.role,
      model: agentDispatches.model,
      output: agentDispatches.output,
      updatedAt: agentDispatches.updatedAt,
    })
    .from(agentDispatches)
    .where(and(
      eq(agentDispatches.tenantId, tenantId),
      eq(agentDispatches.taskId, taskId),
      eq(agentDispatches.status, 'completed'),
    ))
    .orderBy(desc(agentDispatches.updatedAt))
    .limit(50);

  const entries: TaskFileChangeEntry[] = [];
  for (const row of rows) {
    for (const { path, change } of parseDispatchChangedFiles(row.output)) {
      entries.push({
        path,
        change,
        agent: row.role,
        executionId: null,
        createdAt: row.updatedAt,
        // A dispatch names the model it ran; there is no per-file usage ledger
        // for it, so key-source attribution is legitimately unavailable here.
        models: row.model ? [row.model] : [],
        modelUsage: [],
      });
    }
  }
  return entries;
}
