/**
 * Shared finding-dedupe helper.
 *
 * A "finding" on this platform IS a task (there is no separate findings table), so
 * every external-signal ingest (GitHub alerts, the web-security scanner) dedupes by
 * embedding a stable identity marker in the ticket title and refusing to refile when
 * an OPEN ticket already carries that marker — exactly how AuditRunner dedupes on
 * open task titles. This module is the one query behind all of them so the scoping
 * rule (open + non-archived only) lives in a single place.
 *
 * SCOPE: only OPEN tickets are consulted. If a human closed the ticket and the issue
 * reappears, refiling is correct — the problem came back and needs an owner again.
 */
import { and, eq, ne } from 'drizzle-orm';
import { tasks } from '../../infrastructure/database/schema';
import { TaskStatus } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Every marker matched by `re` currently carried by an OPEN task in a project,
 * lowercased. Best-effort: a failed read returns an empty set so the caller falls
 * back to always-file rather than silently dropping real findings.
 */
export async function openTaskMarkers(db: Db, projectId: number, re: RegExp): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ title: tasks.title })
      .from(tasks)
      .where(and(
        eq(tasks.projectId, projectId),
        eq(tasks.archived, false),
        ne(tasks.status, TaskStatus.DONE),
      ));
    const out = new Set<string>();
    for (const r of rows) {
      const m = re.exec(r.title ?? '');
      if (m) out.add(m[0].toLowerCase());
    }
    return out;
  } catch {
    return new Set();
  }
}
