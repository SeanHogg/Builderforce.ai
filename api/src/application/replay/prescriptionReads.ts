/**
 * Prescription READS (PRD 33 §5.1): the ranked list, one prescription, and a
 * release's improvement ledger. Every read goes through `getOrSetCached` under the
 * site's version token; every write (sweep, action, verifier) bumps it.
 *
 * `replay_prescriptions` is a core table keyed by site; the scope's site has
 * already been bound to the caller's workspace (`getSiteForTenant`), so every
 * statement filters by that site id.
 */

import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import type {
  ReplayFilter,
  ReplayImpactDto,
  ReplayPrescriptionActionKind,
  ReplayPrescriptionArea,
  ReplayPrescriptionDto,
  ReplayPrescriptionFindingDto,
  ReplayPrescriptionMeasuredDto,
  ReplayPrescriptionStatus,
  ReplayReleaseReportDto,
} from '@builderforce/interaction-contract';
import { REPLAY_PRESCRIPTION_AREAS } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayPrescriptions } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { NotFoundError, ValidationError } from '../../domain/shared/errors';
import { isUuid, type ReplayScope } from '../../domain/replay/replayScope';
import { PRESCRIPTION_RULE_BY_ID } from '../../domain/replay/prescriptions/rules';
import { rankPrescriptions } from '../../domain/replay/prescriptions/rank';
import {
  decodeActionRef,
  nextActions,
  prescriptionMatchesFilter,
} from '../../domain/replay/prescriptions/prescriptionState';
import { replayReadKeys } from './replayCacheKeys';
import { filterCacheKey } from './replayReadModel';
import { ReplayReadService } from './ReplayReadService';
import { visualOf } from './pageVisual';
import { getSiteForTenant } from './replaySites';
import { holdBuildPreviewWhileRunning } from './prescriptionFixRuns';

export type PrescriptionRow = typeof replayPrescriptions.$inferSelect;

/** Rows a list returns. */
export const PRESCRIPTIONS_LIST_MAX = 100;
const TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };

const STATUSES: readonly ReplayPrescriptionStatus[] = ['proposed', 'applied', 'measuring', 'worked', 'no_effect', 'worse', 'dismissed'];
const ACTION_KINDS: readonly ReplayPrescriptionActionKind[] = ['fix', 'test', 'follow_up', 'ticket', 'dismiss', 'apply_in_composer', 'copy_prompt', 'apply_page'];

const record = (raw: unknown): Record<string, unknown> =>
  (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const iso = (v: Date | string) => (v instanceof Date ? v : new Date(String(v))).toISOString();

function findingOf(raw: unknown): ReplayPrescriptionFindingDto {
  const f = record(raw);
  const params = record(f.params);
  return {
    params: Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === 'string' || typeof v === 'number')) as Record<string, string | number>,
    evidence: Array.isArray(f.evidence)
      ? f.evidence.map(record).filter((e) => typeof e.recordingId === 'string').map((e) => ({ recordingId: String(e.recordingId), atMs: Number(e.atMs) || 0 }))
      : [],
    selector: strOrNull(f.selector),
    label: strOrNull(f.label),
    fingerprint: strOrNull(f.fingerprint),
    affected: Number(f.affected) || 0,
  };
}

export function impactOf(raw: unknown): ReplayImpactDto {
  const i = record(raw);
  const confidence = i.confidence === 'high' || i.confidence === 'medium' ? i.confidence : 'low';
  return {
    estimate: numOrNull(i.estimate),
    low: numOrNull(i.low),
    high: numOrNull(i.high),
    unit: typeof i.unit === 'string' ? i.unit : 'conversions',
    confidence,
    horizonDays: Number(i.horizonDays) || 30,
    estimated: i.estimated === true,
  };
}

export function measuredOf(raw: unknown): ReplayPrescriptionMeasuredDto | null {
  const m = record(raw);
  if (m.verdict !== 'worked' && m.verdict !== 'no_effect' && m.verdict !== 'worse') return null;
  const source = m.source === 'ab_test' || m.source === 'follow_up' ? m.source : 'ticket_effect';
  return {
    before: numOrNull(m.before),
    after: numOrNull(m.after),
    delta: numOrNull(m.delta),
    verdict: m.verdict,
    source,
    releaseKey: strOrNull(m.releaseKey),
    measuredAt: typeof m.measuredAt === 'string' ? m.measuredAt : new Date(0).toISOString(),
  };
}

function acceptanceOf(raw: unknown): ReplayPrescriptionDto['acceptance'] {
  const a = record(raw);
  if (typeof a.metric !== 'string' || (a.direction !== 'up' && a.direction !== 'down')) return null;
  return { metric: a.metric, direction: a.direction, minVisits: Number(a.minVisits) || 0 };
}

/** What the §5.2 page actions need to know beyond the row (`nextActions`). */
export interface PrescriptionDtoContext {
  /** The site is a Builderforce-hosted canvas app (`apply-in-composer`). */
  hostedCanvas?: boolean;
  /** The hosted app's project (`buildPreview`); null for an external site. */
  hostedProjectId?: number | null;
  /** Open fixes on the row's page (`apply-page`); defaults to the row itself. */
  pageAcceptedFixes?: number;
}

const PAGE_ACTION_KINDS: readonly ReplayPrescriptionActionKind[] = ['copy_prompt', 'apply_page', 'apply_in_composer'];
const OPEN_STATUSES = new Set(['proposed', 'applied', 'measuring']);

/** Whether the site is a hosted app, and which project. The ONE place `hostedCanvas` is decided. */
export function hostedContextOf(site: { kind: string; projectId: number | null }): Pick<PrescriptionDtoContext, 'hostedCanvas' | 'hostedProjectId'> {
  const hostedCanvas = site.kind === 'hosted' && site.projectId !== null;
  return { hostedCanvas, hostedProjectId: hostedCanvas ? site.projectId : null };
}

/** The context of the rows of one site: hosted or not, and the open fixes per page. */
export function dtoContextFor(
  site: { kind: string; projectId: number | null },
  rows: readonly Pick<PrescriptionRow, 'pagePath' | 'status'>[],
): (row: Pick<PrescriptionRow, 'pagePath'>) => PrescriptionDtoContext {
  const hosted = hostedContextOf(site);
  const open = new Map<string, number>();
  for (const r of rows) if (r.pagePath && OPEN_STATUSES.has(r.status)) open.set(r.pagePath, (open.get(r.pagePath) ?? 0) + 1);
  return (row) => ({ ...hosted, ...(row.pagePath ? { pageAcceptedFixes: open.get(row.pagePath) ?? 0 } : {}) });
}

/**
 * Can a person build this fix's preview now? A hosted fix that was applied. Whether its
 * coding run has FINISHED is a live fact, not part of the cached row: the readers settle it
 * afterwards with `holdBuildPreviewWhileRunning` (the agent only changes the app's
 * workspace — it cannot build or publish — and building before it is done would publish
 * the unchanged app; with no run at all it is offered at once). Once a preview
 * exists it stays offered, flagged `rebuild`, until the fix moves on (the publish route
 * accepts a replacement preview while the fix is still applied). The browser builds it in
 * the IDE and posts `preview=1&prescription=<id>` to the publish route;
 * `notePrescriptionPreview` records it only on a hosted, still-applied fix of that
 * project (the same status/kind/hosting conditions, not the run state).
 */
function buildPreviewOf(
  status: string,
  actionKind: ReplayPrescriptionActionKind | null,
  refs: { previewRelease: string | null },
  ctx: PrescriptionDtoContext,
): { projectId: number; rebuild: boolean } | null {
  if (status !== 'applied' || actionKind !== 'fix' || ctx.hostedProjectId == null) return null;
  return { projectId: ctx.hostedProjectId, rebuild: refs.previewRelease !== null };
}

/** One row as the contract DTO. `rank` is the row's place in its ranked list. */
export function toPrescriptionDto(row: PrescriptionRow, rank = 0, ctx: PrescriptionDtoContext = {}): ReplayPrescriptionDto {
  const rule = PRESCRIPTION_RULE_BY_ID.get(row.ruleId);
  const refs = decodeActionRef(row.actionRef);
  const ruleActions = rule?.actions ?? [];
  const finding = findingOf(row.finding);
  const actionKind = (ACTION_KINDS as readonly string[]).includes(row.actionKind ?? '') ? (row.actionKind as ReplayPrescriptionActionKind) : null;
  return {
    id: row.id,
    ruleId: row.ruleId,
    area: (REPLAY_PRESCRIPTION_AREAS as readonly string[]).includes(row.area) ? (row.area as ReplayPrescriptionArea) : 'site',
    source: row.source === 'observed' ? 'observed' : 'rule',
    subjectKey: row.subjectKey,
    pagePath: row.pagePath,
    status: (STATUSES as readonly string[]).includes(row.status) ? (row.status as ReplayPrescriptionStatus) : 'proposed',
    finding,
    prescription: row.prescription,
    change: row.change ?? null,
    visual: visualOf(row.visual),
    captureId: row.captureId ?? null,
    impact: impactOf(row.impact),
    actions: [...new Set<ReplayPrescriptionActionKind>([...ruleActions, ...(row.pagePath ? PAGE_ACTION_KINDS : []), 'dismiss'])],
    next: nextActions({
      status: row.status,
      actionKind: row.actionKind,
      refs,
      ruleActions,
      pagePath: row.pagePath,
      hostedCanvas: ctx.hostedCanvas,
      pageAcceptedFixes: ctx.pageAcceptedFixes,
    }),
    actionKind,
    actionRef: row.actionRef,
    refs,
    buildPreview: buildPreviewOf(row.status, actionKind, refs, ctx),
    acceptance: acceptanceOf(row.acceptance),
    measured: measuredOf(row.measured),
    dismissReason: row.dismissReason,
    issueId: strOrNull(record(row.finding).issueId),
    rank,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** The ranked order of a list of rows (impact ÷ effort, low confidence last). */
export function rankRows(rows: readonly PrescriptionRow[]): PrescriptionRow[] {
  return rankPrescriptions(rows.map((row) => ({
    key: `${row.ruleId}|${row.subjectKey}|${row.id}`,
    impact: impactOf(row.impact),
    effort: PRESCRIPTION_RULE_BY_ID.get(row.ruleId)?.effort ?? 2,
    affected: Number(record(row.finding).affected) || 0,
    row,
  }))).map((r) => r.row);
}

/** One row of the scope, uncached (for the writers). 404 outside the site. */
export async function loadPrescriptionRow(db: Db, scope: ReplayScope, prescriptionId: string): Promise<PrescriptionRow> {
  if (!isUuid(prescriptionId)) throw new NotFoundError('Prescription', prescriptionId);
  const [row] = await db
    .select()
    .from(replayPrescriptions)
    .where(and(eq(replayPrescriptions.siteId, scope.siteId), eq(replayPrescriptions.id, prescriptionId)))
    .limit(1);
  if (!row) throw new NotFoundError('Prescription', prescriptionId);
  return row;
}

/**
 * Open prescriptions first (proposed → measuring), then the decided ones, ranked within each.
 *
 * The ranked rows are cached under the site version; whether an applied fix's coding run is
 * still going is NOT (a run ends without bumping that version), so `buildPreview` is settled
 * here, after the cache, with one tenant-scoped read that is skipped when no row offers it.
 */
export async function listPrescriptions(
  env: Env,
  db: Db,
  scope: ReplayScope,
  input: { area?: string | null; status?: string | null; filter?: ReplayFilter | null } = {},
): Promise<ReplayPrescriptionDto[]> {
  return holdBuildPreviewWhileRunning(db, scope.tenantId, await listPrescriptionsCached(env, db, scope, input));
}

/**
 * The ranked list as it is cached: `buildPreview` here does NOT know whether a fix's run is
 * still going. A reader that caches the list (or a view of it) under its own key must read
 * this and apply `holdBuildPreviewWhileRunning` AFTER its own cache.
 */
export async function listPrescriptionsCached(
  env: Env,
  db: Db,
  scope: ReplayScope,
  input: { area?: string | null; status?: string | null; filter?: ReplayFilter | null } = {},
): Promise<ReplayPrescriptionDto[]> {
  const area = input.area?.trim() || '';
  const status = input.status?.trim() || '';
  if (area && !(REPLAY_PRESCRIPTION_AREAS as readonly string[]).includes(area)) {
    throw new ValidationError(`area must be one of ${REPLAY_PRESCRIPTION_AREAS.join(', ')}`);
  }
  if (status && !(STATUSES as readonly string[]).includes(status)) throw new ValidationError(`status must be one of ${STATUSES.join(', ')}`);
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.prescriptions(area, status, filterCacheKey(input.filter)), async () => {
    const rows = await db
      .select()
      .from(replayPrescriptions)
      .where(and(
        eq(replayPrescriptions.siteId, scope.siteId),
        area ? eq(replayPrescriptions.area, area) : undefined,
        status ? eq(replayPrescriptions.status, status) : undefined,
      ))
      .orderBy(desc(replayPrescriptions.updatedAt))
      .limit(PRESCRIPTIONS_LIST_MAX * 2);
    const ranked = rankRows(rows.filter((row) =>
      prescriptionMatchesFilter({ pagePath: row.pagePath, fingerprint: strOrNull(record(row.finding).fingerprint) }, input.filter)));
    const open = ranked.filter((r) => r.status === 'proposed' || r.status === 'applied' || r.status === 'measuring');
    const decided = ranked.filter((r) => !open.includes(r));
    const contextOf = dtoContextFor(await getSiteForTenant(env, db, scope.tenantId, scope.siteId), rows);
    return [...open, ...decided].slice(0, PRESCRIPTIONS_LIST_MAX).map((row, i) => toPrescriptionDto(row, i + 1, contextOf(row)));
  }, TTL);
}

export async function getPrescription(env: Env, db: Db, scope: ReplayScope, prescriptionId: string): Promise<ReplayPrescriptionDto> {
  if (!isUuid(prescriptionId)) throw new NotFoundError('Prescription', prescriptionId);
  const keys = await replayReadKeys(env, scope);
  // Rank is a property of a list; the single read answers the row's place in the open list.
  const list = await listPrescriptions(env, db, scope);
  const ranked = list.find((p) => p.id === prescriptionId);
  if (ranked) return ranked;
  const one = await getOrSetCached(env, `${keys.prescriptions('', '', '')}:one:${prescriptionId}`, async () =>
    toPrescriptionDto(
      await loadPrescriptionRow(db, scope, prescriptionId),
      0,
      hostedContextOf(await getSiteForTenant(env, db, scope.tenantId, scope.siteId)),
    ), TTL);
  return (await holdBuildPreviewWhileRunning(db, scope.tenantId, [one]))[0]!;
}

const REPORT_MAX = 50;

/** The fixes a release shipped (published preview, or measured on it) and their verdicts. */
export async function releaseReport(env: Env, db: Db, scope: ReplayScope, releaseKey: string): Promise<ReplayReleaseReportDto> {
  const key = releaseKey.trim();
  if (!key || key.length > 64) throw new ValidationError('releaseKey is required');
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.releaseReport(key), async () => {
    const release = (await new ReplayReadService(env, db).releases(scope)).find((r) => r.releaseKey === key) ?? null;
    const safe = key.replace(/[%_\\]/g, '');
    const rows = await db
      .select()
      .from(replayPrescriptions)
      .where(and(
        eq(replayPrescriptions.siteId, scope.siteId),
        inArray(replayPrescriptions.status, ['applied', 'measuring', 'worked', 'no_effect', 'worse']),
        or(
          like(replayPrescriptions.actionRef, `%p=${safe}%`),
          sql`${replayPrescriptions.measured}->>'releaseKey' = ${key}`,
        ),
      ))
      .orderBy(desc(replayPrescriptions.updatedAt))
      .limit(REPORT_MAX);
    return {
      releaseKey: key,
      label: release?.label ?? (release ? `R${release.ordinal}` : null),
      firstSeenAt: release?.firstSeenAt ?? null,
      prescriptions: rows
        .filter((row) => decodeActionRef(row.actionRef).previewRelease === key || measuredOf(row.measured)?.releaseKey === key)
        .map((row) => {
          const dto = toPrescriptionDto(row);
          return { id: dto.id, ruleId: dto.ruleId, area: dto.area, status: dto.status, actionKind: dto.actionKind, measured: dto.measured };
        }),
    };
  }, TTL);
}
