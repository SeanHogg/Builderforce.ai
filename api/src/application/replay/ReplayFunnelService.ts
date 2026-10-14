/**
 * Funnels (PRD 33 §2.1 "Funnels — with 'watch who dropped at step N'", §3.2
 * `replay_funnels` + `replay_funnel_steps`).
 *
 * CRUD on core (definitions), evaluation over the KEPT recordings on the telemetry
 * database: the matching rows are read in batches of 500 by keyset up to 20,000
 * (`scanKeptRecordings`, `truncated` when the ceiling is hit) and folded by the pure
 * `evaluateFunnel`. The filter goes through THE compiler. Answers are cached per
 * (funnel, days, filter) under the site version; every write bumps it.
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
import type {
  ReplayFilter,
  ReplayFunnelDto,
  ReplayFunnelEvalDto,
  ReplayFunnelInput,
  ReplayFunnelStepDto,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayFunnels, replayFunnelSteps } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { NotFoundError, ValidationError } from '../../domain/shared/errors';
import { isUuid, type ReplayScope } from '../../domain/replay/replayScope';
import { evaluateFunnel, interpolateStepTimes, type FunnelStepSpec } from '../../domain/replay/funnelFold';
import { bumpSiteVersion, replayReadKeys } from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import { clampDays, filterCacheKey } from './replayReadModel';
import { compileScopeFilter } from './replaySmartEventRules';
import { scanKeptRecordings } from './replayKeptScan';

export const FUNNEL_STEPS_MIN = 2;
export const FUNNEL_STEPS_MAX = 10;
export const MAX_FUNNELS_PER_SITE = 50;
const NAME_MAX = 120;
const MATCH_MAX = 400;
/** Longest funnel window: 30 days, so month-long loops ("The method") are ordinary funnels. */
export const FUNNEL_WINDOW_MAX_MINUTES = 30 * 24 * 60;
const TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };

type FunnelRow = typeof replayFunnels.$inferSelect;
type StepRow = typeof replayFunnelSteps.$inferSelect;

/** The label a step shows: the match itself, prefixed by what kind of step it is. */
function stepLabel(step: Pick<StepRow, 'stepKind' | 'match'>): string {
  return `${step.stepKind}: ${step.match}`;
}

function toStepDto(step: StepRow): ReplayFunnelStepDto {
  return {
    ord: step.ord,
    stepKind: step.stepKind === 'click' || step.stepKind === 'event' ? step.stepKind : 'page',
    match: step.match,
    matchMode: step.matchMode === 'prefix' || step.matchMode === 'contains' ? step.matchMode : 'equals',
    label: stepLabel(step),
  };
}

function toDto(row: FunnelRow, steps: StepRow[]): ReplayFunnelDto {
  return {
    id: row.id,
    name: row.name,
    windowMinutes: row.windowMinutes,
    steps: steps.filter((s) => s.funnelId === row.id).sort((a, b) => a.ord - b.ord).map(toStepDto),
  };
}

/** Validate a funnel a person built. */
export function validateFunnelInput(raw: Partial<ReplayFunnelInput>): Required<ReplayFunnelInput> {
  const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > NAME_MAX) throw new ValidationError(`A funnel needs a name of 1–${NAME_MAX} characters`);
  const windowMinutes = raw.windowMinutes === undefined ? 30 : Math.round(Number(raw.windowMinutes));
  if (!Number.isFinite(windowMinutes) || windowMinutes < 1 || windowMinutes > FUNNEL_WINDOW_MAX_MINUTES) {
    throw new ValidationError(`windowMinutes must be 1–${FUNNEL_WINDOW_MAX_MINUTES}`);
  }
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  if (steps.length < FUNNEL_STEPS_MIN || steps.length > FUNNEL_STEPS_MAX) {
    throw new ValidationError(`A funnel has ${FUNNEL_STEPS_MIN}–${FUNNEL_STEPS_MAX} steps`);
  }
  return {
    name,
    windowMinutes,
    steps: steps.map((step, i) => {
      if (step?.stepKind !== 'page' && step?.stepKind !== 'click' && step?.stepKind !== 'event') {
        throw new ValidationError(`Step ${i + 1}: stepKind must be page, click or event`);
      }
      if (step.matchMode !== 'equals' && step.matchMode !== 'prefix' && step.matchMode !== 'contains') {
        throw new ValidationError(`Step ${i + 1}: matchMode must be equals, prefix or contains`);
      }
      const match = typeof step.match === 'string' ? step.match.trim() : '';
      if (!match || match.length > MATCH_MAX) throw new ValidationError(`Step ${i + 1}: match must be 1–${MATCH_MAX} characters`);
      return { stepKind: step.stepKind, match, matchMode: step.matchMode };
    }),
  };
}

export class ReplayFunnelService {
  private readonly store: Db;

  constructor(private readonly env: Env, private readonly db: Db, private readonly clock: () => Date = () => new Date()) {
    this.store = replayTelemetryDb(env, db);
  }

  async list(scope: ReplayScope): Promise<ReplayFunnelDto[]> {
    const keys = await replayReadKeys(this.env, scope);
    return getOrSetCached(this.env, keys.funnels(), async () => {
      const funnels = await this.db
        .select()
        .from(replayFunnels)
        .where(eq(replayFunnels.siteId, scope.siteId))
        .orderBy(asc(replayFunnels.createdAt))
        .limit(MAX_FUNNELS_PER_SITE);
      if (funnels.length === 0) return [];
      const steps = await this.db
        .select()
        .from(replayFunnelSteps)
        .where(inArray(replayFunnelSteps.funnelId, funnels.map((f) => f.id)))
        .orderBy(asc(replayFunnelSteps.funnelId), asc(replayFunnelSteps.ord));
      return funnels.map((row) => toDto(row, steps));
    }, TTL);
  }

  async get(scope: ReplayScope, funnelId: string): Promise<ReplayFunnelDto> {
    if (!isUuid(funnelId)) throw new NotFoundError('Funnel', funnelId);
    const found = (await this.list(scope)).find((f) => f.id === funnelId);
    if (!found) throw new NotFoundError('Funnel', funnelId);
    return found;
  }

  async create(scope: ReplayScope, raw: Partial<ReplayFunnelInput>, userId: string | null): Promise<ReplayFunnelDto> {
    const input = validateFunnelInput(raw);
    if ((await this.list(scope)).length >= MAX_FUNNELS_PER_SITE) {
      throw new ValidationError(`A site keeps at most ${MAX_FUNNELS_PER_SITE} funnels`);
    }
    const [row] = await this.db
      .insert(replayFunnels)
      .values({ siteId: scope.siteId, name: input.name, windowMinutes: input.windowMinutes, createdBy: userId })
      .returning();
    const steps = await this.db
      .insert(replayFunnelSteps)
      .values(input.steps.map((step, ord) => ({ funnelId: row!.id, ord, ...step })))
      .returning();
    await bumpSiteVersion(this.env, scope.siteId);
    return toDto(row!, steps);
  }

  /** Replace name, window and steps. 404 for a funnel not on this site. */
  async update(scope: ReplayScope, funnelId: string, raw: Partial<ReplayFunnelInput>): Promise<ReplayFunnelDto> {
    if (!isUuid(funnelId)) throw new NotFoundError('Funnel', funnelId);
    const input = validateFunnelInput(raw);
    const [row] = await this.db
      .update(replayFunnels)
      .set({ name: input.name, windowMinutes: input.windowMinutes })
      .where(and(eq(replayFunnels.siteId, scope.siteId), eq(replayFunnels.id, funnelId)))
      .returning();
    if (!row) throw new NotFoundError('Funnel', funnelId);
    await this.db.delete(replayFunnelSteps).where(eq(replayFunnelSteps.funnelId, row.id));
    const steps = await this.db
      .insert(replayFunnelSteps)
      .values(input.steps.map((step, ord) => ({ funnelId: row.id, ord, ...step })))
      .returning();
    await bumpSiteVersion(this.env, scope.siteId);
    return toDto(row, steps);
  }

  async remove(scope: ReplayScope, funnelId: string): Promise<void> {
    if (!isUuid(funnelId)) throw new NotFoundError('Funnel', funnelId);
    const removed = await this.db
      .delete(replayFunnels)
      .where(and(eq(replayFunnels.siteId, scope.siteId), eq(replayFunnels.id, funnelId)))
      .returning({ id: replayFunnels.id });
    if (removed.length === 0) throw new NotFoundError('Funnel', funnelId);
    await bumpSiteVersion(this.env, scope.siteId);
  }

  /** Evaluate over the kept recordings of the window that pass the filter (≈). */
  async evaluate(
    scope: ReplayScope,
    funnelId: string,
    input: { days?: number; filter?: ReplayFilter | null } = {},
  ): Promise<ReplayFunnelEvalDto> {
    const funnel = await this.get(scope, funnelId);
    const days = clampDays(input.days);
    const keys = await replayReadKeys(this.env, scope);
    return getOrSetCached(this.env, keys.funnelEval(funnelId, days, filterCacheKey(input.filter)), async () => {
      const { where } = await compileScopeFilter(this.env, this.db, scope, input.filter);
      const scan = await scanKeptRecordings(this.store, scope, {
        since: new Date(this.clock().getTime() - days * 86_400_000),
        where,
      });
      const specs: FunnelStepSpec[] = funnel.steps.map((s) => ({ ...s }));
      const folded = evaluateFunnel(
        scan.rows.map((row) => ({
          recordingId: row.id,
          weight: row.sampleWeight,
          steps: interpolateStepTimes(row.steps, row.durationMs),
          clicked: row.clicked,
        })),
        specs,
        funnel.windowMinutes,
      );
      return { funnelId, steps: folded.steps, truncated: scan.truncated || folded.truncated, estimated: true as const };
    }, TTL);
  }
}
