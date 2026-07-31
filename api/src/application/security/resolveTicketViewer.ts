/**
 * resolveTicketViewer — build the {@link TicketViewer} for the current HTTP request
 * (the human on the other end of a task read), so security-ticket visibility is
 * decided from a single, consistent identity. userId + role come from the auth
 * context; account_type (freelancer ⇒ talent) is a cached lookup.
 *
 * Used by the task read routes; the resolved viewer is passed to
 * SecurityTicketAccessService to filter the access-restricted SECURITY tickets.
 */
import { eq } from 'drizzle-orm';
import { users } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { TenantRole } from '../../domain/shared/types';
import type { Context } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { TicketViewer } from './SecurityTicketAccessService';

/** The caller's account_type (cached — it changes rarely). 'standard' when unknown. */
async function accountTypeFor(env: Env | undefined, db: Db, userId: string): Promise<string> {
  const load = async (): Promise<string> => {
    const [row] = await db.select({ accountType: users.accountType }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.accountType ?? 'standard';
  };
  if (!env) return load();
  return getOrSetCached(env, `user-account-type:${userId}`, load, { kvTtlSeconds: 300 });
}

/** Resolve the human viewer behind an authenticated task-read request. */
export async function resolveTicketViewer(c: Context<HonoEnv>, db: Db): Promise<TicketViewer> {
  const userId = (c.get('userId') as string | undefined) ?? null;
  const role = (c.get('role') as TenantRole | undefined) ?? null;
  const accountType = userId ? await accountTypeFor(c.env as Env, db, userId) : null;
  return { userId, role, accountType, isAgent: false };
}
