/**
 * Smart events (PRD 33 §2.1 "Smart events (auto + custom, retroactive)", §3.2
 * `replay_smart_events`, §3.4).
 *
 * The list is the built-ins (code data, `id: null`, one entry per NAME) followed by
 * the site's own rules, each with how many kept recordings in the window hit it —
 * weighted by `sample_weight`, so it is ≈ like every kept-recording number. All
 * counts come from ONE grouped statement: one `sum(case when <predicate> …)` column
 * per event, the predicates built by THE compiler, so a count and the filter
 * `smartEvent = X` can never disagree.
 *
 * Rules are retroactive: a new rule counts recordings already kept, because it is
 * evaluated over the stored arrays at read time.
 */

import { and, eq, gte, sql, type SQL } from 'drizzle-orm';
import {
  BUILTIN_SMART_EVENT_NAMES,
  BUILTIN_SMART_EVENTS,
  fnv1a64,
  type ReplaySmartEventDto,
  type ReplaySmartEventInput,
  type SmartEventRule,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayRecordings, replaySmartEvents } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { isUniqueViolation } from '../../infrastructure/database/uniqueViolation';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/shared/errors';
import { isUuid, type ReplayScope } from '../../domain/replay/replayScope';
import { bumpSiteVersion, replayReadKeys } from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import { clampDays } from './replayReadModel';
import { rulePredicate, smartEventPredicate } from './replayFilterCompiler';
import { MAX_SITE_SMART_EVENTS, siteSmartEventRows } from './replaySmartEventRules';

const NAME_MAX = 120;
const MATCH_MAX = 400;
const TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };
const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTIN_SMART_EVENT_NAMES);

/** Validate a rule a person typed. Built-in names are reserved. */
export function validateSmartEventInput(raw: Partial<ReplaySmartEventInput>): SmartEventRule {
  const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > NAME_MAX) throw new ValidationError(`A smart event needs a name of 1–${NAME_MAX} characters`);
  if (BUILTIN_NAMES.has(name.toLowerCase())) throw new ValidationError(`"${name}" is a built-in smart event`);
  if (raw.ruleKind !== 'page' && raw.ruleKind !== 'click' && raw.ruleKind !== 'custom') {
    throw new ValidationError('ruleKind must be page, click or custom');
  }
  if (raw.matchMode !== 'equals' && raw.matchMode !== 'prefix' && raw.matchMode !== 'contains') {
    throw new ValidationError('matchMode must be equals, prefix or contains');
  }
  const match = typeof raw.match === 'string' ? raw.match.trim() : '';
  if (!match || match.length > MATCH_MAX) throw new ValidationError(`A rule needs a match of 1–${MATCH_MAX} characters`);
  return { name, ruleKind: raw.ruleKind, match, matchMode: raw.matchMode };
}

/** The built-ins as list entries: one per name, described by its first rule. */
function builtinEntries(): Array<Omit<ReplaySmartEventDto, 'count'>> {
  return BUILTIN_SMART_EVENT_NAMES.map((name) => {
    const first = BUILTIN_SMART_EVENTS.find((rule) => rule.name === name)!;
    return { id: null, name, ruleKind: first.ruleKind, match: first.match, matchMode: first.matchMode, builtin: true };
  });
}

/**
 * Weighted kept-recording counts for several predicates in ONE statement over the
 * window. Index i of the answer is predicate i.
 */
async function weightedCounts(store: Db, scope: ReplayScope, since: Date, predicates: SQL[]): Promise<number[]> {
  if (predicates.length === 0) return [];
  const columns: Record<string, SQL<number>> = {};
  predicates.forEach((predicate, i) => {
    columns[`c${i}`] = sql<number>`coalesce(sum(case when ${predicate} then ${replayRecordings.sampleWeight} else 0 end), 0)`;
  });
  const [row] = await store
    .select(columns)
    .from(replayRecordings)
    .where(and(
      eq(replayRecordings.tenantId, scope.tenantId),
      eq(replayRecordings.siteId, scope.siteId),
      gte(replayRecordings.startedAt, since),
    ));
  return predicates.map((_, i) => Math.round(Number((row as Record<string, unknown> | undefined)?.[`c${i}`] ?? 0) || 0));
}

const sinceOf = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/** Built-ins then the site's rules, each with its ≈ count in the window. */
export async function listSmartEvents(
  env: Env,
  db: Db,
  scope: ReplayScope,
  input: { days?: number; now?: Date } = {},
): Promise<ReplaySmartEventDto[]> {
  const days = clampDays(input.days);
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.smartEvents(days), async () => {
    const siteRules = await siteSmartEventRows(env, db, scope);
    const entries: Array<Omit<ReplaySmartEventDto, 'count'>> = [
      ...builtinEntries(),
      ...siteRules.map((rule) => ({
        id: rule.id, name: rule.name, ruleKind: rule.ruleKind, match: rule.match, matchMode: rule.matchMode, builtin: false,
      })),
    ];
    const counts = await weightedCounts(
      replayTelemetryDb(env, db),
      scope,
      sinceOf(input.now ?? new Date(), days),
      entries.map((entry) => smartEventPredicate(entry.name, { siteRules })),
    );
    return entries.map((entry, i) => ({ ...entry, count: counts[i] ?? 0 }));
  }, TTL);
}

/** How many kept recordings in the window a rule WOULD match, before saving it. */
export async function previewSmartEvent(
  env: Env,
  db: Db,
  scope: ReplayScope,
  raw: Partial<ReplaySmartEventInput>,
  input: { days?: number; now?: Date } = {},
): Promise<{ count: number }> {
  const rule = validateSmartEventInput({ ...raw, name: raw.name || 'preview' });
  const days = clampDays(input.days);
  const keys = await replayReadKeys(env, scope);
  const ruleKey = fnv1a64(JSON.stringify([rule.ruleKind, rule.matchMode, rule.match]));
  return getOrSetCached(env, keys.smartEventPreview(ruleKey, days), async () => {
    // The rule alone — not the stored events of the same name, not a built-in.
    const [count] = await weightedCounts(
      replayTelemetryDb(env, db),
      scope,
      sinceOf(input.now ?? new Date(), days),
      [rulePredicate(rule)],
    );
    return { count: count ?? 0 };
  }, TTL);
}

export async function createSmartEvent(
  env: Env,
  db: Db,
  scope: ReplayScope,
  raw: Partial<ReplaySmartEventInput>,
  userId: string | null,
): Promise<ReplaySmartEventDto> {
  const rule = validateSmartEventInput(raw);
  if ((await siteSmartEventRows(env, db, scope)).length >= MAX_SITE_SMART_EVENTS) {
    throw new ValidationError(`A site keeps at most ${MAX_SITE_SMART_EVENTS} smart events`);
  }
  try {
    const [row] = await db
      .insert(replaySmartEvents)
      .values({ siteId: scope.siteId, name: rule.name, ruleKind: rule.ruleKind, match: rule.match, matchMode: rule.matchMode, createdBy: userId })
      .returning({ id: replaySmartEvents.id });
    await bumpSiteVersion(env, scope.siteId);
    return { id: row!.id, ...rule, builtin: false, count: 0 };
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`A smart event named "${rule.name}" already exists on this site`);
    throw error;
  }
}

export async function deleteSmartEvent(env: Env, db: Db, scope: ReplayScope, eventId: string): Promise<void> {
  if (!isUuid(eventId)) throw new NotFoundError('Smart event', eventId);
  const removed = await db
    .delete(replaySmartEvents)
    .where(and(eq(replaySmartEvents.siteId, scope.siteId), eq(replaySmartEvents.id, eventId)))
    .returning({ id: replaySmartEvents.id });
  if (removed.length === 0) throw new NotFoundError('Smart event', eventId);
  await bumpSiteVersion(env, scope.siteId);
}
