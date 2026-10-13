/**
 * A site's own smart-event RULES as the filter compiler and the funnels read them
 * (PRD 33 §3.2 `replay_smart_events`, §3.4). Built-ins are code data
 * (`BUILTIN_SMART_EVENTS`) and never rows.
 *
 * Its own small module so the compiler's callers (`ReplayReadService`, the overview,
 * funnels, flow) and the smart-event CRUD (`replaySmartEvents.ts`) share one cached
 * read without importing each other. The rows are definitions on CORE; the caller
 * has already proved the site is the caller's workspace's (`getSiteForTenant`).
 */

import { asc, eq } from 'drizzle-orm';
import type {
  ReplayFilter,
  SmartEventMatchMode,
  SmartEventRule,
  SmartEventRuleKind,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replaySmartEvents } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { ValidationError } from '../../domain/shared/errors';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { replayReadKeys } from './replayCacheKeys';
import { compileReplayFilter, filterNeedsSiteRules, type CompiledFilter } from './replayFilterCompiler';

/** Most rules one site may define. */
export const MAX_SITE_SMART_EVENTS = 100;

const RULES_TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };

export interface SiteSmartEventRow extends SmartEventRule {
  id: string;
  createdAt: string;
}

const RULE_KINDS: ReadonlySet<string> = new Set<SmartEventRuleKind>(['page', 'click', 'custom']);
const MATCH_MODES: ReadonlySet<string> = new Set<SmartEventMatchMode>(['equals', 'prefix', 'contains']);

export function asRuleKind(value: string): SmartEventRuleKind {
  return RULE_KINDS.has(value) ? (value as SmartEventRuleKind) : 'custom';
}

export function asMatchMode(value: string): SmartEventMatchMode {
  return MATCH_MODES.has(value) ? (value as SmartEventMatchMode) : 'equals';
}

/** The site's rules, oldest first, cached under the site version. */
export async function siteSmartEventRows(env: Env, db: Db, scope: ReplayScope): Promise<SiteSmartEventRow[]> {
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.smartEventRules(), async () => {
    const rows = await db
      .select()
      .from(replaySmartEvents)
      .where(eq(replaySmartEvents.siteId, scope.siteId))
      .orderBy(asc(replaySmartEvents.createdAt))
      .limit(MAX_SITE_SMART_EVENTS);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ruleKind: asRuleKind(row.ruleKind),
      match: row.match,
      matchMode: asMatchMode(row.matchMode),
      createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt))).toISOString(),
    }));
  }, RULES_TTL);
}

/**
 * Compile a filter for one scope: reads the site's rules only when a clause needs
 * them, and refuses (400) a clause the compiler rejects rather than widening the
 * result by ignoring it.
 */
export async function compileScopeFilter(
  env: Env,
  db: Db,
  scope: ReplayScope,
  filter: ReplayFilter | null | undefined,
): Promise<CompiledFilter> {
  const siteRules = filterNeedsSiteRules(filter) ? await siteSmartEventRows(env, db, scope) : [];
  const compiled = compileReplayFilter(filter, { siteRules });
  if (compiled.rejected.length) {
    throw new ValidationError(compiled.rejected.map((r) => r.reason).join('; '));
  }
  return compiled;
}
