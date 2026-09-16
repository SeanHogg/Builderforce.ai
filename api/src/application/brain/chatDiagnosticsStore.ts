/**
 * chatDiagnosticsStore — write and read ONE captured verdict about a Brain chat.
 *
 * ── WHY A MODULE AND NOT A BRAINSERVICE METHOD ──────────────────────────────────
 * `BrainService` is already the largest thing in this folder and the trace/message
 * lifecycle is most of it. Diagnostics share nothing with that lifecycle except a chat
 * id: they are written by the client at capture time, read by a person or a model asking
 * "why did the last run not finish?", and never touched by the run itself. So they live
 * in their own leaf, depending only on the schema and the connection. Nothing in the
 * service needs to grow for a capture to be stored.
 *
 * ── WHAT A CAPTURE IS ───────────────────────────────────────────────────────────
 * A `ChatDiagnosticsReport` — `{ schemaVersion, capturedAt, surface, likelyCause, chat,
 * run, staffing }` — computed CLIENT-SIDE from the whole run, because that is where the
 * facts are while they are still complete (the trace is capped, the model pool rotates,
 * the staffing changes). This module stores the document whole and lifts the four fields
 * the read paths index on into columns. It does not recompute or second-guess the
 * verdict; it also does not trust the size of it.
 *
 * ── TWO LIMITS, BOTH DELIBERATE ─────────────────────────────────────────────────
 * SIZE: a report is bounded at {@link MAX_REPORT_BYTES}. A run with hundreds of turns can
 * produce a document larger than the row it belongs in, and the honest response is to drop
 * the two arrays that grow without bound (`run.modelTurns`, `run.errorSteps`) — the
 * verdict, the cause and the pressure numbers are what the reader came for, and a
 * truncated list still says how many there were. Only if it is STILL too big does the
 * write refuse, and it refuses with a 413 rather than silently storing half a document.
 *
 * RETENTION: {@link MAX_REPORTS_PER_CHAT} captures per chat, oldest deleted in the same
 * call that inserts. A chat the user keeps re-running would otherwise accumulate one row
 * per attempt forever, and nobody reads the fortieth-most-recent verdict. The cap lives
 * here, beside the clamp, rather than in a trigger — both are the same product decision
 * about how much of this is worth keeping, and splitting them across two places is how
 * they come to disagree.
 */
import { desc, eq, lt } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { brainChatDiagnostics } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { DomainError, ValidationError } from '../../domain/shared/errors';

/** Serialized ceiling for one stored report. Roughly a very long run's worth of detail. */
export const MAX_REPORT_BYTES = 512 * 1024;

/** How many captures one chat keeps. Reading further back than this has never happened. */
export const MAX_REPORTS_PER_CHAT = 25;

/** The two arrays that grow with the run, dropped first when a report is over size. */
const TRUNCATABLE_RUN_ARRAYS = ['modelTurns', 'errorSteps'] as const;

/**
 * A report too large to store even after truncation.
 *
 * Its own class, carrying `status = 413`, because `statusOf` honours an integer status and
 * "your payload is too big" is the caller's problem to fix — answering 400 would send them
 * looking for a malformed field, and 500 would report a defect that is not one.
 */
export class DiagnosticsTooLargeError extends DomainError {
  readonly status = 413;
  constructor(bytes: number) {
    super(`diagnostics report is ${bytes} bytes; the limit is ${MAX_REPORT_BYTES}`);
    this.name = 'DiagnosticsTooLargeError';
  }
}

/** The stored shape, as `latestChatDiagnostics` returns it. */
export interface StoredChatDiagnostics {
  id: number;
  chatId: number;
  surface: string;
  schemaVersion: number;
  likelyCause: string | null;
  capturedAt: Date;
  createdAt: Date;
  report: unknown;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A string field off the report, trimmed and bounded to its column width. */
function str(report: Json, key: string, maxLength: number): string | null {
  const raw = report[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

/**
 * The instant the capture claims, or now.
 *
 * A client clock that is wrong produces a wrong `capturedAt` and that is FINE — it is the
 * client's own statement about its own run, and `createdAt` records when it actually
 * arrived. What is not fine is an unparseable string reaching a NOT NULL timestamptz, so
 * anything that is not a real date falls back to the arrival instant.
 */
function capturedAtOf(report: Json): Date {
  const raw = report.capturedAt;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * Bring `report` under {@link MAX_REPORT_BYTES}, or throw.
 *
 * Truncates the unbounded arrays first, replacing each with a marker that preserves the
 * COUNT — "there were 412 model turns and here are none of them" is a usable answer;
 * "there were no model turns" is a false one.
 */
function clampReport(report: Json): Json {
  const size = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value) ?? '').length;
  if (size(report) <= MAX_REPORT_BYTES) return report;

  const run = isObject(report.run) ? { ...report.run } : null;
  if (run) {
    for (const key of TRUNCATABLE_RUN_ARRAYS) {
      const list = run[key];
      if (!Array.isArray(list) || list.length === 0) continue;
      run[key] = [];
      run[`${key}Truncated`] = list.length;
      const candidate = { ...report, run };
      if (size(candidate) <= MAX_REPORT_BYTES) return candidate;
    }
  }

  const clamped = run ? { ...report, run } : report;
  const bytes = size(clamped);
  if (bytes > MAX_REPORT_BYTES) throw new DiagnosticsTooLargeError(bytes);
  return clamped;
}

/**
 * Persist one capture and enforce the per-chat cap.
 *
 * The delete runs in the same call as the insert, not on a schedule, so the table's size
 * is a property of the write path rather than of whether a cron ran.
 */
export async function saveChatDiagnostics(
  db: Db,
  args: { chatId: number; tenantId: number; report: unknown },
): Promise<{ id: number }> {
  if (!isObject(args.report)) throw new ValidationError('report must be an object');
  const report = clampReport(args.report);

  const schemaVersion = typeof report.schemaVersion === 'number' && Number.isInteger(report.schemaVersion)
    ? report.schemaVersion
    : 1;

  const [row] = await db
    .insert(brainChatDiagnostics)
    .values({
      chatId: args.chatId,
      tenantId: args.tenantId,
      // A capture that names no surface is still a capture; 'unknown' keeps the NOT NULL
      // column honest instead of rejecting the report over a missing label.
      surface: str(report, 'surface', 32) ?? 'unknown',
      schemaVersion,
      likelyCause: str(report, 'likelyCause', 64),
      capturedAt: capturedAtOf(report),
      report,
    })
    .returning({ id: brainChatDiagnostics.id });

  await pruneChatDiagnostics(db, args.chatId, args.tenantId);
  return { id: row!.id };
}

/**
 * Drop everything older than the newest {@link MAX_REPORTS_PER_CHAT} captures.
 *
 * Ordered by `id`, not `capturedAt`: the id is the arrival order, and two captures taken
 * in the same millisecond (a retry loop does exactly that) would otherwise have no stable
 * order to retain on. Tenant-scoped: a chat id is not a tenancy boundary on its own.
 */
async function pruneChatDiagnostics(db: Db, chatId: number, tenantId: number): Promise<void> {
  const keep = await db
    .select({ id: brainChatDiagnostics.id })
    .from(brainChatDiagnostics)
    .where(scopedToTenant(brainChatDiagnostics, tenantId, eq(brainChatDiagnostics.chatId, chatId)))
    .orderBy(desc(brainChatDiagnostics.id))
    .limit(MAX_REPORTS_PER_CHAT);
  if (keep.length < MAX_REPORTS_PER_CHAT) return;

  const oldestKept = keep[keep.length - 1]!.id;
  await db
    .delete(brainChatDiagnostics)
    .where(scopedToTenant(
      brainChatDiagnostics,
      tenantId,
      eq(brainChatDiagnostics.chatId, chatId),
      lt(brainChatDiagnostics.id, oldestKept),
    ));
}

/**
 * The latest captures for a chat, newest first.
 *
 * Access is the CALLER's to check (the routes share `brainService.canAccess` with the
 * trace routes): a store that re-derived chat visibility would be a second answer to a
 * question the service already owns.
 */
export async function latestChatDiagnostics(
  db: Db,
  chatId: number,
  tenantId: number,
  limit = 1,
): Promise<StoredChatDiagnostics[]> {
  const bounded = Math.max(1, Math.min(Math.trunc(limit) || 1, MAX_REPORTS_PER_CHAT));
  return db
    .select({
      id: brainChatDiagnostics.id,
      chatId: brainChatDiagnostics.chatId,
      surface: brainChatDiagnostics.surface,
      schemaVersion: brainChatDiagnostics.schemaVersion,
      likelyCause: brainChatDiagnostics.likelyCause,
      capturedAt: brainChatDiagnostics.capturedAt,
      createdAt: brainChatDiagnostics.createdAt,
      report: brainChatDiagnostics.report,
    })
    .from(brainChatDiagnostics)
    .where(scopedToTenant(brainChatDiagnostics, tenantId, eq(brainChatDiagnostics.chatId, chatId)))
    .orderBy(desc(brainChatDiagnostics.id))
    .limit(bounded);
}
