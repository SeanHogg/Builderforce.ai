/**
 * The files one Brain chat changed, as recorded on its work deltas — so a host can
 * show "this chat's changes" instead of every uncommitted file in the workspace.
 *
 * Tenant-scoped at the query (a chat id alone is not an authorization); the route
 * additionally checks the caller can access the chat. Served by
 * `idx_work_deltas_tenant_chat` (migration 1187). Not cached: a running chat records
 * new deltas turn by turn, and the read is one indexed lookup per chat.
 */
import { and, eq } from 'drizzle-orm';
import { workDeltas } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export async function chatChangedFiles(db: Db, tenantId: number, chatId: number): Promise<string[]> {
  const rows = await db
    .select({ files: workDeltas.files })
    .from(workDeltas)
    .where(and(eq(workDeltas.tenantId, tenantId), eq(workDeltas.chatId, chatId)));
  const files = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row.files)) continue;
    for (const file of row.files) if (typeof file === 'string' && file) files.add(file);
  }
  return [...files];
}
