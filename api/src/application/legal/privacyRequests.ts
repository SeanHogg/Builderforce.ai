import { and, desc, eq, getTableColumns, ilike, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { privacyRequests, tenantMembers, userLegalAcceptances, users } from '../../infrastructure/database/schema';
import { InternalError } from '../../domain/shared/errors';
import type { UserId } from '../../domain/shared/types';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { DAY_MS } from '../../domain/shared/time';

/**
 * Data-subject requests (CCPA / GDPR) — the application half of the privacy
 * channel.
 *
 * These endpoints used to be written inline in `authRoutes.ts`, which is why a
 * privacy request was filed by the same module that mints sessions. The URLs
 * stay under `/api/auth/...` (the legal pages and Settings call them); the SQL
 * lives here, next to the terms-acceptance record it sits beside.
 *
 * Two doors, one table:
 *   - the PUBLIC door takes an email and an unverified request — a visitor with
 *     no account, or one who cannot sign in, still has the right to ask;
 *   - the ACCOUNT door takes the identity from the WebJWT, so the request is
 *     filed as already verified.
 *
 * And one list + one fulfilment, each taking a scope: the data subject sees
 * their own requests (`/api/auth/me/privacy-requests`); the platform operator
 * sees and fulfils everyone's (`/api/admin/privacy-requests`). The operator half
 * used to be inline SQL in `adminRoutes.ts`, with its own narrower copy of the
 * type and status vocabularies (two of eleven types, three of seven statuses).
 *
 * NOT this channel: `/api/governance/dsr` is a WORKSPACE's own register of the
 * requests ITS end users send it (the workspace is the controller there), and
 * `POST /api/hiring/candidates/:ref/erase` is a workspace erasing a candidate it
 * holds. Both are tenant-owned; this table is Builderforce answering as the
 * controller of the account itself.
 */

/** Statutory response window we commit to (45 days covers both CCPA and GDPR). */
const RESPONSE_WINDOW_MS = 45 * DAY_MS;

const ACCOUNT_REQUEST_TYPES = [
  'access', 'correction', 'deletion', 'portability', 'restriction', 'objection', 'opt_out', 'appeal', 'automated_decision_review',
] as const;
const PUBLIC_REQUEST_TYPES = ['ccpa', 'gdpr', ...ACCOUNT_REQUEST_TYPES] as const;
/** Mirrors `privacy_request_status`. Terminal ones stamp `closed_at`. */
const REQUEST_STATUSES = ['pending', 'verifying', 'processing', 'completed', 'denied', 'appealed', 'closed'] as const;
const TERMINAL_STATUSES: ReadonlySet<PrivacyRequestStatus> = new Set(['completed', 'denied', 'closed']);

export type PrivacyRequestStatus = (typeof REQUEST_STATUSES)[number];

export function isPrivacyRequestStatus(value: unknown): value is PrivacyRequestStatus {
  return REQUEST_STATUSES.includes(value as PrivacyRequestStatus);
}

/** Every type a request can carry (the public door's set is the whole enum). */
export function isPrivacyRequestType(value: unknown): value is PublicPrivacyRequestType {
  return PUBLIC_REQUEST_TYPES.includes(value as PublicPrivacyRequestType);
}

export type AccountPrivacyRequestType = (typeof ACCOUNT_REQUEST_TYPES)[number];
export type PublicPrivacyRequestType = (typeof PUBLIC_REQUEST_TYPES)[number];

export function isAccountPrivacyRequestType(value: unknown): value is AccountPrivacyRequestType {
  return ACCOUNT_REQUEST_TYPES.includes(value as AccountPrivacyRequestType);
}

/** The public door never refuses on type — an unrecognised one is filed as an access request. */
export function publicPrivacyRequestType(value: unknown): PublicPrivacyRequestType {
  return PUBLIC_REQUEST_TYPES.includes(value as PublicPrivacyRequestType) ? (value as PublicPrivacyRequestType) : 'access';
}

export interface PrivacyRequestDetails {
  details?: string | null;
  jurisdiction?: string | null;
  parentRequestId?: unknown;
}

function commonFields(input: PrivacyRequestDetails) {
  return {
    details: input.details?.trim() || null,
    jurisdiction: input.jurisdiction?.trim().slice(0, 32) || null,
    parentRequestId: Number.isInteger(input.parentRequestId) ? (input.parentRequestId as number) : null,
    dueAt: new Date(Date.now() + RESPONSE_WINDOW_MS),
  };
}

/** File a request from the public legal page. `email` is already normalized. */
export async function filePublicPrivacyRequest(
  db: Db,
  input: PrivacyRequestDetails & { email: string; requestType: PublicPrivacyRequestType },
): Promise<{ id: number }> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  const [created] = await db
    .insert(privacyRequests)
    .values({ userId: user?.id ?? null, email: input.email, requestType: input.requestType, ...commonFields(input) })
    .returning({ id: privacyRequests.id });
  if (!created) throw new InternalError('Failed to create privacy request');
  return { id: created.id };
}

/**
 * The machine-readable access/portability bundle for the signed-in person:
 * identity, memberships, legal record and their own DSRs. Workspace CONTENT is
 * exported from its owning surface. Null when the account no longer exists.
 */
export async function buildPrivacyExport(db: Db, userId: UserId) {
  const [account] = await db
    .select({
      id: users.id, email: users.email, username: users.username, displayName: users.displayName,
      accountType: users.accountType, locale: users.locale, createdAt: users.createdAt, updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) return null;
  const [memberships, legalAcceptances, requests] = await Promise.all([
    db.select({ ...getTableColumns(tenantMembers), tenantId: tenantMembers.tenantId }).from(tenantMembers).where(eq(tenantMembers.userId, userId)),
    db.select().from(userLegalAcceptances).where(eq(userLegalAcceptances.userId, userId)),
    db.select().from(privacyRequests).where(eq(privacyRequests.userId, userId)),
  ]);
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), account, memberships, legalAcceptances, privacyRequests: requests };
}

/**
 * File a request from inside the account. Identity is already verified by the
 * WebJWT, so the row starts verified and in `processing` (an appeal starts
 * `appealed`). A deletion also records the processor and backup disposition so
 * the fulfilment trail is complete from the first row. Null when the account no
 * longer exists.
 */
export async function fileAccountPrivacyRequest(
  db: Db,
  userId: UserId,
  input: PrivacyRequestDetails & { requestType: AccountPrivacyRequestType },
) {
  const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!account) return null;
  const isDeletion = input.requestType === 'deletion';
  const [created] = await db.insert(privacyRequests).values({
    userId,
    email: account.email,
    requestType: input.requestType,
    ...commonFields(input),
    status: input.requestType === 'appeal' ? 'appealed' : 'processing',
    verifiedAt: new Date(),
    processorDeletionStatus: isDeletion ? { state: 'queued', providers: 'derived from tenant integrations and subprocessor register' } : null,
    backupDisposition: isDeletion ? 'Queued for live-system deletion; encrypted backups age out under the retention schedule and are not returned to production except disaster recovery.' : null,
  }).returning({ id: privacyRequests.id, status: privacyRequests.status, dueAt: privacyRequests.dueAt });
  return created ?? null;
}

/**
 * Who is looking at the channel:
 *   - `subject` — the signed-in person, their own requests, newest first;
 *   - `platform_admin` — the operator queue across every account, most recently
 *     touched first, optionally filtered. Gated before this is reached.
 */
export type PrivacyRequestScope =
  | { kind: 'subject'; userId: UserId }
  | { kind: 'platform_admin'; status?: string; type?: string; q?: string; limit: number };

const ADMIN_LIST_MAX = 1000;

export async function listPrivacyRequests(db: Db, scope: PrivacyRequestScope) {
  if (scope.kind === 'subject') {
    return db
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.userId, scope.userId))
      .orderBy(desc(privacyRequests.createdAt))
      .limit(LIST_ROW_CAP);
  }
  // An unrecognised filter value is ignored rather than refused — the console's
  // contract since it shipped.
  const q = scope.q?.trim();
  const filters = [
    isPrivacyRequestStatus(scope.status) ? eq(privacyRequests.status, scope.status) : undefined,
    isPrivacyRequestType(scope.type) ? eq(privacyRequests.requestType, scope.type) : undefined,
    q ? ilike(privacyRequests.email, `%${q}%`) : undefined,
  ].filter((f): f is SQL => f !== undefined);
  return db
    .select()
    .from(privacyRequests)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(privacyRequests.updatedAt))
    .limit(Math.min(Math.max(1, Math.floor(scope.limit)), ADMIN_LIST_MAX));
}

/**
 * The operator's fulfilment step: move a request along and record the
 * resolution. A terminal status stamps `closed_at`. Null when no such request.
 */
export async function updatePrivacyRequest(
  db: Db,
  id: number,
  patch: { status?: unknown; resolution?: string | null },
) {
  const set: Partial<typeof privacyRequests.$inferInsert> = { updatedAt: new Date() };
  if (isPrivacyRequestStatus(patch.status)) {
    set.status = patch.status;
    if (TERMINAL_STATUSES.has(patch.status)) set.closedAt = new Date();
  }
  if (typeof patch.resolution === 'string') set.resolution = patch.resolution.trim() || null;
  if (patch.resolution === null) set.resolution = null;
  const [updated] = await db.update(privacyRequests).set(set).where(eq(privacyRequests.id, id)).returning();
  return updated ?? null;
}
