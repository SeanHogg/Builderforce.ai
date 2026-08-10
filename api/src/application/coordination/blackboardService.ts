/**
 * blackboardService — the shared workspace concurrent agents use to talk to each other.
 *
 * One row per (scope, key): posting the same key OVERWRITES, because the board holds
 * current intent, not history. History already exists in `tool_audit_events` (every
 * `workspace_note` call is recorded there like any other tool call), so appending here
 * would duplicate a stream that is already durable and already rendered on the timeline.
 *
 * Scoped to a ticket. A note is working state for the ticket being worked; anything
 * that should outlive it is memory, which has its own scope/TTL/provenance contract in
 * application/memory. Keeping those two apart is the whole point — the previous
 * failure mode was cross-run knowledge and within-run chatter landing in the same store.
 *
 * Reads go through the read-through cache behind a per-scope version token (bumped on
 * every post), because `workspace_read` is called repeatedly inside a single run.
 */

import { desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { WorkspaceNoteResult, WorkspaceReadResult } from '@builderforce/agent-tools';
import { coordinationNotes } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const NOTES_DEFAULT_LIMIT = 20;
const NOTES_MAX_LIMIT = 100;
const NOTES_L1_TTL_MS = 5_000;

const versionKey = (tenantId: number, scopeKey: string): string => `blackboard:ver:${tenantId}:${scopeKey}`;

/** Significant words for the optional lexical filter (mirrors the memory tokenizer). */
function tokenize(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length > 1))].slice(0, 12);
}

export interface NoteAuthor {
  tenantId: number;
  scopeKey: string;
  taskId: number | null;
  executionId: number | null;
  label: string;
}

/** Publish or overwrite one note. Never throws — a board failure must not fail a run. */
export async function postNote(env: Env, db: Db, author: NoteAuthor, key: string, content: string): Promise<WorkspaceNoteResult> {
  const k = key.trim().slice(0, 255);
  if (!k || !content.trim()) return { ok: false, error: 'key and content are required' };
  try {
    await db
      .insert(coordinationNotes)
      .values({
        tenantId: author.tenantId,
        scopeKey: author.scopeKey,
        taskId: author.taskId,
        key: k,
        content,
        authorExecutionId: author.executionId,
        authorLabel: author.label,
      })
      .onConflictDoUpdate({
        target: [coordinationNotes.tenantId, coordinationNotes.scopeKey, coordinationNotes.key],
        set: { content, authorExecutionId: author.executionId, authorLabel: author.label, updatedAt: new Date() },
      });
    await bumpCacheVersion(env, versionKey(author.tenantId, author.scopeKey));
    return { ok: true, key: k };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Read one scope's board, newest first, optionally filtered lexically. `viewerExecutionId`
 * marks a reader's own notes so an agent can tell its intent apart from its peers'.
 */
export async function readNotes(
  env: Env,
  db: Db,
  tenantId: number,
  scopeKey: string,
  opts?: { query?: string; limit?: number; viewerExecutionId?: number | null },
): Promise<WorkspaceReadResult> {
  const limit = Math.min(Math.max(1, Math.trunc(opts?.limit ?? NOTES_DEFAULT_LIMIT)), NOTES_MAX_LIMIT);
  const query = opts?.query?.trim() ?? '';
  try {
    const ver = await getCacheVersion(env, versionKey(tenantId, scopeKey));
    const rows = await getOrSetCached(
      env,
      `blackboard:list:${tenantId}:${scopeKey}:${ver}:${limit}:${query}`,
      async () => {
        const words = query ? tokenize(query) : [];
        const matchers = words.flatMap((w) => [ilike(coordinationNotes.content, `%${w}%`), ilike(coordinationNotes.key, `%${w}%`)]);
        const lexical: SQL | undefined = matchers.length > 0 ? or(...matchers) : undefined;
        return db
          .select({
            key: coordinationNotes.key,
            content: coordinationNotes.content,
            author: coordinationNotes.authorLabel,
            authorExecutionId: coordinationNotes.authorExecutionId,
            updatedAt: coordinationNotes.updatedAt,
          })
          .from(coordinationNotes)
          .where(scopedToTenant(coordinationNotes, tenantId, eq(coordinationNotes.scopeKey, scopeKey), lexical))
          .orderBy(desc(coordinationNotes.updatedAt))
          .limit(limit);
      },
      { l1TtlMs: NOTES_L1_TTL_MS },
    );
    return {
      ok: true,
      notes: rows.map((r) => ({
        key: r.key,
        content: r.content,
        author: r.author,
        updatedAt: new Date(r.updatedAt).toISOString(),
        mine: opts?.viewerExecutionId != null && r.authorExecutionId === opts.viewerExecutionId,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
