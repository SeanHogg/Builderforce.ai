/**
 * A canvas FRAME, delivered on a cadence — the board pack.
 *
 * ── WHAT WAS BROKEN ──────────────────────────────────────────────────────────────
 * `canvasExports.ts` renders any canvas object to .pptx/.xlsx/.docx/.pdf on demand, and
 * `runDueReports` already dispatches a report to recipients on a daily/weekly/monthly
 * cadence with an advancing watermark that survives a failing generator. The two had
 * never been introduced, and `finance.report_subscriptions` existed with no canvas
 * binding at all — a grep for it across `frontend/src` returned nothing.
 *
 * So the two standing obligations of a finance function — the monthly investor update
 * and the board pack — were hand-assembled off the board every single period. That is
 * exactly the recurring work "idea to REAL" claims to remove, and the unit of delivery
 * already existed: a `frame` is the object that GROUPS the tiles a pack is made of.
 *
 * ── WHY THIS IS A GENERATOR AND NOT A SECOND DISPATCHER ─────────────────────────
 * It plugs into `ScheduledReportGenerator`, the seam `runDueReports` already takes. A
 * board-pack scheduler of its own would have had to re-decide the batch bound, the
 * watermark advance, the "advance even on failure so a broken schedule cannot
 * retry-storm" rule and the recipient parsing — four decisions already made correctly
 * once. This is the fifth report type, not a second reporting system.
 *
 * ── WHAT IT DELIVERS ────────────────────────────────────────────────────────────
 * The frame's own tiles, resolved to the numbers they carry AT SEND TIME, with each
 * money figure parsed through the same rules the board uses. Not a screenshot and not a
 * link: a pack that requires the reader to log in to see the numbers is a notification,
 * and the recipient list for a board pack is exactly the set of people who do not have
 * an account.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { creationSessionObjects, creationSessions } from '../../infrastructure/database/schema';

/** `"<sessionId>:<frameObjectId>"`, as stored in `report_schedules.subject_ref`. */
export interface BoardPackSubject {
  sessionId: string;
  frameId: string;
}

/**
 * Parse a subject reference.
 *
 * Returns null rather than throwing for a malformed value: a schedule with a broken
 * reference must skip and let the watermark advance, not fail the whole tick for every
 * other schedule behind it in the batch.
 */
export function parseBoardPackSubject(subjectKind: string | null, subjectRef: string | null): BoardPackSubject | null {
  if (subjectKind !== 'canvas_frame' || !subjectRef) return null;
  const at = subjectRef.indexOf(':');
  if (at <= 0 || at === subjectRef.length - 1) return null;
  return { sessionId: subjectRef.slice(0, at), frameId: subjectRef.slice(at + 1) };
}

/** Build one — `"<sessionId>:<frameObjectId>"`. */
export function boardPackSubjectRef(sessionId: string, frameId: string): string {
  return `${sessionId}:${frameId}`;
}

/** One tile as it appears in the delivered pack. */
export interface BoardPackTile {
  id: string;
  kind: string;
  title: string;
  status: string | null;
  /** The handful of figures this tile carries, already formatted for a reader. */
  figures: Array<{ label: string; value: string }>;
  summary: string | null;
}

export interface BoardPack {
  frameTitle: string;
  sessionTitle: string;
  generatedAtISO: string;
  tiles: BoardPackTile[];
  /** Tiles the frame references that no longer exist. Reported, never silently dropped —
   *  a pack that quietly lost a section reads as a pack with nothing to say there. */
  missing: string[];
}

/**
 * The fields worth putting in a pack, per kind.
 *
 * A pack is READ, not browsed, so it carries the figures a reader would look for and not
 * every field the object holds. Registry data rather than a branch per kind, so a new
 * finance object appears in the pack the moment it is declared here — and one that is
 * NOT declared renders its title and summary rather than nothing, which is the safe
 * default for an object the pack was not designed around.
 */
const PACK_FIGURES: Readonly<Record<string, readonly string[]>> = {
  liveMetric: ['value', 'unit', 'target', 'trend', 'fetchedAt'],
  kpi: ['value', 'unit', 'target', 'trend'],
  budget: ['period', 'plannedTotal', 'actualTotal', 'variance', 'currency'],
  forecast: ['horizon', 'runwayMonths', 'basis', 'currency'],
  invoice: ['customer', 'amount', 'paidAmount', 'dueAt', 'ageingDays', 'currency'],
  bill: ['vendor', 'amount', 'dueAt', 'category', 'currency'],
  capTable: ['postMoney', 'fullyDiluted', 'optionPool'],
  fundingRound: ['roundType', 'targetAmount', 'committed', 'valuation', 'closeTarget'],
  investorUpdate: ['period'],
  pricing: ['pricingModel', 'grossMargin', 'paybackMonths'],
  headcountPlan: ['period', 'approvedTotal', 'actualTotal', 'annualCost', 'currency'],
  objective: ['progress', 'target'],
  trigger: ['watches', 'comparator', 'threshold', 'state'],
};

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('en-US') : null;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.amount === 'number') {
      return `${record.amount.toLocaleString('en-US')}${record.currency ? ` ${record.currency}` : ''}`;
    }
    return null;
  }
  const text = String(value).trim();
  return text ? text.slice(0, 200) : null;
}

/**
 * Assemble the pack for one frame.
 *
 * Returns null when the frame or its session is gone — a deleted board must stop
 * delivering rather than deliver an empty pack that reads as "nothing happened".
 */
export async function buildBoardPack(db: Db, tenantId: number, subject: BoardPackSubject, now: Date): Promise<BoardPack | null> {
  const [session] = await db
    .select({ id: creationSessions.id, title: creationSessions.title })
    .from(creationSessions)
    .where(and(eq(creationSessions.id, subject.sessionId), eq(creationSessions.tenantId, tenantId)))
    .limit(1);
  if (!session) return null;

  // One read for every object on the session, then the frame's membership is resolved in
  // memory. A per-tile query would be the N+1 the performance standard rejects, and the
  // frame's child list is on the frame itself so there is nothing to join to.
  const objects = await db
    .select({ id: creationSessionObjects.id, kind: creationSessionObjects.kind, canvasData: creationSessionObjects.canvasData })
    .from(creationSessionObjects)
    .where(eq(creationSessionObjects.sessionId, subject.sessionId));

  const frame = objects.find((object) => object.id === subject.frameId);
  if (!frame) return null;

  const frameData = (frame.canvasData ?? {}) as Record<string, unknown>;
  const memberIds = Array.isArray(frameData.children)
    ? frameData.children.filter((id): id is string => typeof id === 'string')
    : [];

  const byId = new Map(objects.map((object) => [object.id, object]));
  const tiles: BoardPackTile[] = [];
  const missing: string[] = [];

  for (const id of memberIds) {
    const object = byId.get(id);
    if (!object) { missing.push(id); continue; }
    const data = (object.canvasData ?? {}) as Record<string, unknown>;
    const figures = (PACK_FIGURES[object.kind] ?? [])
      .flatMap((field) => {
        const value = readString(data, field);
        return value ? [{ label: field, value }] : [];
      });
    tiles.push({
      id,
      kind: object.kind,
      title: readString(data, 'title') ?? object.kind,
      status: readString(data, 'status'),
      figures,
      summary: readString(data, 'summary'),
    });
  }

  return {
    frameTitle: readString(frameData, 'title') ?? 'Board pack',
    sessionTitle: session.title,
    generatedAtISO: now.toISOString(),
    tiles,
    missing,
  };
}

/**
 * The `ScheduledReportGenerator` half — what `buildScheduledReport` delegates to.
 *
 * Deliberately returns null (rather than an empty pack) for a frame that is gone or
 * holds nothing: `runDueReports` skips a null and still advances the watermark, so a
 * board someone deleted quietly stops sending instead of mailing a blank page to the
 * investors every month.
 */
export async function buildBoardPackReport(
  db: Db,
  tenantId: number,
  subjectKind: string | null,
  subjectRef: string | null,
  now: Date,
): Promise<{ subject: string; report: Record<string, unknown> } | null> {
  const parsed = parseBoardPackSubject(subjectKind, subjectRef);
  if (!parsed) return null;
  const pack = await buildBoardPack(db, tenantId, parsed, now);
  if (!pack || pack.tiles.length === 0) return null;
  return {
    subject: `[Builderforce] ${pack.frameTitle}`,
    report: pack as unknown as Record<string, unknown>,
  };
}

/** Frames on a session that could back a schedule — what the "schedule this" picker reads. */
export async function listSchedulableFrames(db: Db, tenantId: number, sessionId: string): Promise<Array<{ id: string; title: string; tileCount: number }>> {
  const [session] = await db
    .select({ id: creationSessions.id })
    .from(creationSessions)
    .where(and(eq(creationSessions.id, sessionId), eq(creationSessions.tenantId, tenantId)))
    .limit(1);
  if (!session) return [];

  const frames = await db
    .select({ id: creationSessionObjects.id, canvasData: creationSessionObjects.canvasData })
    .from(creationSessionObjects)
    .where(and(eq(creationSessionObjects.sessionId, sessionId), inArray(creationSessionObjects.kind, ['frame'])));

  return frames.map((frame) => {
    const data = (frame.canvasData ?? {}) as Record<string, unknown>;
    return {
      id: frame.id,
      title: readString(data, 'title') ?? 'Frame',
      tileCount: Array.isArray(data.children) ? data.children.length : 0,
    };
  });
}
