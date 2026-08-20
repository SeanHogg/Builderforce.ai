/**
 * Creation Sessions — durable, tenant-owned canvas workspaces.
 *
 * The canvas persists placement/native content here while canonical resources
 * (projects, workflows, agents, sites, tasks, …) remain referenced by type/id.
 */
import { Hono, type Context } from 'hono';
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { authMiddleware } from '../../presentation/middleware/authMiddleware';
import { scope } from '../../presentation/routes/segmentTrackerRoutes';
import {
  creationSessionConnections,
  creationSessionComments,
  creationSessionClaims,
  brainChats,
  brainChatMessages,
  creationSessionEvents,
  creationSessionMembers,
  creationSessionObjects,
  creationSessionProjectLinks,
  creationSessionSnapshots,
  creationSessionTemplates,
  creationSessionTimeline,
  creationSessions,
  ceremonySessions,
  ideAgents,
  ideProjects,
  agents,
  tasks,
  workflows,
  workflowDefinitions,
  projects,
  specs,
  taskSpecs,
  specVersions,
  tenantMembers,
  tenants,
  users,
} from '../../infrastructure/database/schema';
import {
  appForSession,
  cachedAppForSession,
  convertSessionToApp,
  copyableLinkFilter,
} from '../canvas/convertSessionToApp';
import { checkSubdomainAvailability } from '../ide/siteHosting';
import type { Db } from '../../infrastructure/database/connection';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Env, HonoEnv } from '../../env';
import { resolveAppBaseUrl } from '../../env';
import { resolveChatAccess } from '../brain/chatAccess';
import { getLimits, type PlanLimits } from '../../domain/tenant/PlanLimits';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { TenantBillingStatus, TenantPlan } from '../../domain/shared/types';
import { notify } from '../notifications/notify';
import {
  isConfidentialityLevel,
  isCreationConnectionKind,
  isCreationObjectKind,
  projectPublicResumeFamily,
  type CanvasResumeFamily,
  type ConfidentialityLevel,
  type CreationObjectKind,
} from '@builderforce/creation-canvas-contract';
import { broadcastRoom, creationSessionRoomName } from '../../infrastructure/relay/broadcastRoom';
import { relayToRoom } from '../../presentation/routes/realtimeRelay';
import { sendTransactionalEmail } from '../email/sendEmail';
import { sendCreationSessionInviteEmail } from '../../infrastructure/email/EmailService';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { bumpPublicCanvasVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { isOutcomePhase, normalizeOutcomeAction, recordOutcomeEvent } from '../outcomes/outcomeLedger';
import { buildAttributedOutcomes } from '../outcomes/attributedOutcomes';
import {
  NORTH_STAR_METRIC_KEY,
  OUTCOME_BASELINE_COHORT,
  OUTCOME_DEFINITION_VERSION,
  OUTCOME_FAMILY_LABELS,
  OUTCOME_METRIC_FAMILIES,
  aggregateMetricValue,
  outcomeAggregateSql,
  outcomeFactsSql,
  toOutcomeMetricValues,
  type OutcomeFact,
} from '../outcomes/outcomeMetricContract';
import { normalizeChatMode } from '../brain/chatMode';
import { sha256Hex } from '../../domain/shared/hash';
import {
  createShareLink,
  findObject,
  getObject,
  getObjectShares,
  registerObject,
  revokeShareLink,
  type ObjectRef,
} from '../kernel/ObjectRegistry';
import { resolveIsSuperadmin } from '../../infrastructure/auth/superadminFlag';
import { creationSessionQuotaError, resolveCreationSessionQuota } from '../../domain/tenant/creationSessionQuota';
import {
  acceptInvitation,
  acceptInvitationStatement,
  findByTokenHash,
  invalidateInvitations,
  invite as inviteToObject,
  listForObject,
  revokeInvitation,
} from '../kernel/InvitationService';
import {
  resolveSessionAccess, SESSION_ROLE_RANK, type SessionRole as SharedSessionRole,
} from './sessionAccess';
// THE graph write. The delete/re-insert/bump/event/snapshot sequence below used to be
// spelled out twice in this file (`PUT /:id/graph` and `POST /:id/commands`) and had
// already started to differ between the two copies; the public `/api/v1` item CRUD is
// the third caller. See `creationGraphWriter.ts` for why it returns statements rather
// than executing them.
import {
  buildPreview,
  creationGraphStatements,
  creationObjectSearchText,
  newCreationSessionStatements,
  CREATION_UUID_RE as UUID_RE,
  uuidKey,
  validCreationGraph,
  type GraphConnectionInput,
  type GraphObjectInput,
} from './creationGraphWriter';

// Re-exported because they MOVED, not because they changed: `creationListings.ts`,
// the public `/api/v1` canvas service and this module's own tests import them from
// here, and a move is not a reason to make every caller change its import.
export { creationObjectSearchText, validCreationGraph };
// The prospect share — the same `share_links` primitive the résumé shares already use,
// pointed at a whole board or one commercial card. Kept in its own module because the
// projection it serves is a BUYER's read (see `prospectShare.ts`), not a member's.
import {
  findCardShare, listProspectShares, mintProspectShare,
  readProspectEngagement, revokeProspectShare, SHAREABLE_CANVAS_KINDS,
  type ProspectShareSettings,
} from '../sales/prospectShare';

type SessionRole = SharedSessionRole;
const ROLE_RANK = SESSION_ROLE_RANK;

export function creationKindForModality(modality: string): CreationObjectKind {
  // An IDE project is one Builder object regardless of the studio it opens.
  // Mapping modalities to website/video/voice/etc. produced preview cards, but
  // discarded the IDE binding and made its actual tools unreachable.
  void modality;
  return 'build';
}

type CreateSessionBody = { title?: string; description?: string; initialPrompt?: string; projectIds?: number[] };
type PatchSessionBody = { title?: string; description?: string | null; folder?: string | null; status?: string; preview?: unknown; mode?: string };
type SaveGraphBody = { objects?: GraphObjectInput[]; connections?: GraphConnectionInput[]; viewport?: unknown; expectedRevision?: number };
type InviteBody = { userId?: string; email?: string; role?: string; expiresInHours?: number };
type CommentBody = { body?: string; objectId?: string | null; parentCommentId?: string | null; mentions?: string[]; anchor?: unknown };
type ResumeShareBody = { expiresAt?: string | null; maxUses?: number | null };
type ProspectShareBody = {
  objectId?: string | null; label?: string; expiresAt?: string | null;
  sellerName?: string; sellerCompany?: string; accentColor?: string;
  allowControlRequest?: boolean; message?: string;
};
type CanvasCommand = { type?: string; [key: string]: unknown };
type CommandsBody = { commands?: CanvasCommand[]; atomic?: boolean };
type PinBody = { pinned?: boolean };
type CheckpointBody = { label?: string };
type WatchBody = { state?: string };
type LockBody = { action?: 'acquire' | 'renew' | 'release'; leaseSeconds?: number };
type TemplateBody = { name?: string; description?: string; category?: string; visibility?: string; graph?: unknown };
type BranchBody = { title?: string };
type MergeBody = { sourceSessionId?: string; resolutions?: Record<string, 'source' | 'target'> };
type ClaimSessionBody = SaveGraphBody & { clientSessionId?: string; title?: string; initialPrompt?: string; timeline?: Array<{ clientMessageId?: string; role?: string; body?: string; metadata?: unknown; createdAt?: string }> };
type MemberBody = { role?: string };
type ExpandProjectBody = { lens?: 'everything' | 'delivery' | 'metrics' | 'customer-feedback' };
type TimelineBody = { clientMessageId?: string; role?: 'user' | 'assistant' | 'system'; body?: string; metadata?: unknown };
type OutcomeBody = {
  correlationId?: string;
  action?: string;
  phase?: 'started' | 'succeeded' | 'failed' | 'validated' | 'reused';
  actorType?: 'user' | 'agent' | 'brain' | 'system';
  actorRef?: string;
  projectId?: number;
  metricKey?: string;
  metricValue?: number;
  unit?: string;
  artifactId?: string;
  durationMs?: number;
  costUsdMillicents?: number;
  metadata?: unknown;
};

const BUILT_IN_TEMPLATE_IDS = ['campaign', 'product-discovery', 'data-story', 'stand-up', 'model-build', 'executive-review'] as const;


export function creationSessionSearchStatus(raw: unknown): 'active' | 'archived' | 'all' {
  return raw === 'archived' || raw === 'all' ? raw : 'active';
}

/** Expected loser of a concurrent revision or idempotency-key insert race. */
export function isCreationEventWriteConflict(error: unknown): boolean {
  const detail = error && typeof error === 'object'
    ? error as { code?: unknown; constraint?: unknown; message?: unknown }
    : null;
  const text = [detail?.constraint, detail?.message, error instanceof Error ? error.message : String(error)]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const isUniqueViolation = detail?.code === '23505' || /duplicate key|unique constraint|23505/i.test(text);
  return isUniqueViolation && /(?:uq_creation_events_(?:revision|idempotency)|creation_session_events_session_id_(?:revision|idempotency_key)_key)/i.test(text);
}

/**
 * What a Postgres error was actually about, as far as the driver will say.
 *
 * `db.batch` on neon-http reports ONE message for the whole batch and no
 * statement index, so a `duplicate key value violates unique constraint
 * "creation_session_objects_pkey"` arriving from a six-statement claim names the
 * TABLE and nothing else — not which row, not how many were in flight, not
 * whether the ids the caller sent were even distinct. That is exactly the report
 * the register had to reason about by inference, and inference is how a fix gets
 * declared for a path nobody proved was taken.
 *
 * The constraint name is the only handle the driver gives, so it is extracted
 * rather than guessed at, and the caller maps it back onto its own labelled
 * inventory of what it was about to write.
 */
export function pgFailureDetail(error: unknown): { code: string | null; constraint: string | null } {
  const detail = error && typeof error === 'object'
    ? error as { code?: unknown; constraint?: unknown; message?: unknown }
    : null;
  const text = [detail?.message, error instanceof Error ? error.message : String(error)]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const named = typeof detail?.constraint === 'string' && detail.constraint
    ? detail.constraint
    : /unique constraint "([^"]+)"|violates [a-z ]*constraint "([^"]+)"/i.exec(text)?.slice(1).find(Boolean) ?? null;
  return {
    code: typeof detail?.code === 'string' ? detail.code : null,
    constraint: named,
  };
}

/**
 * How many of `values` are distinct once case is ignored.
 *
 * The claim's own primary-key collision had exactly this shape: `UUID_RE` accepts
 * either case, the `uuid` column does not distinguish them, and a validator using
 * a case-SENSITIVE Set therefore passed two ids that Postgres then rejected as
 * one. Reporting BOTH counts is what makes the next occurrence readable — equal
 * counts rule that cause out, unequal counts confirm it, and a guess does neither.
 */
export function distinctIdCounts(values: readonly string[]): { total: number; distinct: number; distinctCaseless: number } {
  return {
    total: values.length,
    distinct: new Set(values).size,
    distinctCaseless: new Set(values.map((value) => value.toLowerCase())).size,
  };
}

/** One write the claim was about to make, with enough about it to say which one
 *  failed when the driver reports only a constraint name. */
export interface PlannedClaimWrite {
  table: string;
  rows: number;
  statement: unknown;
}

/**
 * Map a batch failure back onto the inventory that produced it.
 *
 * Postgres names the CONSTRAINT, and every index this schema creates is named
 * after its table (creation_session_objects_pkey, uq_creation_events_revision).
 * That is enough to recover the statement index the driver drops — and when it is
 * not, the report says the index is unknown rather than asserting one, because a
 * wrong index sends the next reader to the wrong statement.
 */
export function describeClaimBatchFailure(
  error: unknown,
  planned: readonly PlannedClaimWrite[],
): Record<string, unknown> {
  const { code, constraint } = pgFailureDetail(error);
  const index = constraint
    ? planned.findIndex((write) => constraint.toLowerCase().includes(write.table.toLowerCase()))
    : -1;
  return {
    pgCode: code,
    constraint,
    statementIndex: index >= 0 ? index : null,
    statementTable: index >= 0 ? planned[index]!.table : null,
    statementRows: index >= 0 ? planned[index]!.rows : null,
    statementCount: planned.length,
    plan: planned.map((write) => `${write.table}:${write.rows}`),
  };
}

function parseTemplateGraph(raw: unknown): { objects: GraphObjectInput[]; connections: GraphConnectionInput[]; viewport?: unknown } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const graph = raw as { objects?: unknown; connections?: unknown; viewport?: unknown };
  if (!Array.isArray(graph.objects) || !Array.isArray(graph.connections)) return null;
  const objects = graph.objects as GraphObjectInput[];
  const connections = graph.connections as GraphConnectionInput[];
  return validCreationGraph(objects, connections) ? null : { objects, connections, viewport: graph.viewport };
}

function cleanTitle(raw: unknown, fallback = 'Untitled session'): string {
  const title = typeof raw === 'string' ? raw.trim() : '';
  return (title || fallback).slice(0, 255);
}

function cleanRole(raw: unknown): SessionRole | null {
  return typeof raw === 'string' && raw in ROLE_RANK ? raw as SessionRole : null;
}

export type CreationCommentAnchor = {
  kind: 'resume-field'; revisionId: string; section: string; entryId?: string; field?: string;
};

/** Bound, semantic anchors only; never persist arbitrary client JSON beside a comment. */
export function cleanCommentAnchor(raw: unknown): CreationCommentAnchor | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.kind !== 'resume-field' || typeof value.revisionId !== 'string' || !value.revisionId.trim()
    || typeof value.section !== 'string' || !value.section.trim()) return null;
  const bounded = (candidate: unknown, max: number) => typeof candidate === 'string' && candidate.trim() ? candidate.trim().slice(0, max) : undefined;
  return {
    kind: 'resume-field', revisionId: value.revisionId.trim().slice(0, 128), section: value.section.trim().slice(0, 64),
    ...(bounded(value.entryId, 128) ? { entryId: bounded(value.entryId, 128) } : {}),
    ...(bounded(value.field, 64) ? { field: bounded(value.field, 64) } : {}),
  };
}

/**
 * A session's entry in the object registry — what its invitations point at now
 * that `creation_session_invites.session_id` is gone (migration 0435).
 *
 * TWO helpers rather than one, because the registry write is an upsert and a GET
 * must not perform one: `ensure` runs on the invite-creation path, where a session
 * that has never been registered is exactly the case that needs fixing, and `find`
 * runs on list and revoke, where a missing entry means there are no invitations to
 * show and a write would be a read path quietly mutating the database.
 */
type SessionRef = { id: string; tenantId: number; title: string };

async function ensureSessionObject(db: Db, env: Env, session: SessionRef): Promise<ObjectRef> {
  return registerObject(db, env, {
    tenantId: session.tenantId,
    kind: 'creation_session',
    refId: session.id,
    domain: 'canvas',
    title: session.title,
  });
}

async function findSessionObject(db: Db, session: SessionRef): Promise<ObjectRef | null> {
  return findObject(db, session.tenantId, 'creation_session', session.id);
}

/** Is this résumé object publishable by link? One answer, shared with the projection
 *  that actually serves it — a third private copy of this rule is how a résumé comes to
 *  be share-able but un-viewable. */
function publicResumeFamily(content: unknown): CanvasResumeFamily | null {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  return projectPublicResumeFamily((content as Record<string, unknown>).resumeFamily);
}

async function ensureResumeObject(db: Db, env: Env, access: { session: SessionRef }, objectId: string) {
  const [row] = await db.select({ id: creationSessionObjects.id, kind: creationSessionObjects.kind, content: creationSessionObjects.content })
    .from(creationSessionObjects)
    .where(and(eq(creationSessionObjects.id, objectId), eq(creationSessionObjects.sessionId, access.session.id)))
    .limit(1);
  if (!row || row.kind !== 'resume' || !publicResumeFamily(row.content)) return null;
  const parent = await ensureSessionObject(db, env, access.session);
  const title = cleanTitle((row.content as Record<string, unknown>).title, 'Resume');
  return registerObject(db, env, {
    tenantId: access.session.tenantId,
    kind: 'canvas_resume',
    refId: row.id,
    domain: 'canvas',
    title,
    parentId: parent.id,
  });
}


/**
 * Browser-local graph ids are only identities inside that draft. The database
 * primary keys are global, so carrying a local id across the claim boundary can
 * collide with an object from an earlier session (for example, a locally saved
 * copy of a durable canvas). Give every claimed row a new durable identity and
 * rewrite the edge endpoints as one graph operation.
 */
export function durableCreationGraph(
  objects: GraphObjectInput[],
  connections: GraphConnectionInput[],
  newId: () => string = () => crypto.randomUUID(),
): { objects: GraphObjectInput[]; connections: GraphConnectionInput[] } {
  // Keyed case-insensitively for the same reason `validCreationGraph` is: an
  // edge that spells its endpoint in a different case than the object does is
  // still pointing at that object, and a case-sensitive map would resolve it to
  // `undefined` and violate the connection's NOT NULL / foreign key instead.
  const objectIds = new Map(objects.map((object) => [uuidKey(object.id), newId()]));
  return {
    objects: objects.map((object) => ({ ...object, id: objectIds.get(uuidKey(object.id))! })),
    connections: connections.map((edge) => ({
      ...edge,
      id: newId(),
      sourceObjectId: objectIds.get(uuidKey(edge.sourceObjectId))!,
      targetObjectId: objectIds.get(uuidKey(edge.targetObjectId))!,
    })),
  };
}

/**
 * Claim-only: a connection's client-supplied `id` never survives {@link
 * durableCreationGraph} above — it is always discarded and re-minted — so
 * `validCreationGraph`'s UUID-shape check on it protects nothing at the claim
 * boundary, unlike `sourceObjectId`/`targetObjectId`, which genuinely have to
 * resolve, or the `PUT /:id/graph` save path, which inserts `edge.id` as the
 * real primary key and needs the strict check to keep a malformed value out
 * of the database.
 *
 * A browser build (2026-08 and earlier) that shipped `pickObject`'s connection
 * id as `` `${fromNodeId}-${node.id}` `` instead of a fresh UUID left drafts
 * sitting in visitors' local storage with that malformed id baked in — the
 * fix stops NEW drafts from getting a bad id, but does nothing for one already
 * written before the fix shipped, and `claim` rejected it forever (`Invalid
 * connection id: …`) with no way for that visitor to ever get past it. Since
 * the id is thrown away regardless, replace a non-UUID one with a fresh UUID
 * before validation rather than let a legacy client bug permanently block the
 * one thing claiming exists to do — hand the visitor's own work to their new
 * account.
 */
export function sanitizeClaimConnectionIds(connections: GraphConnectionInput[]): GraphConnectionInput[] {
  return connections.map((edge) => (UUID_RE.test(edge.id) ? edge : { ...edge, id: crypto.randomUUID() }));
}

export function createCreationSessionRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** Delegated to `sessionAccess.ts`, which the sell-motion routes read too. A second
   *  copy of an authorization check is the copy that keeps granting after the original
   *  learns to refuse — see that module's header. */
  const membership = (sessionId: string, tenantId: number, userId: string) =>
    resolveSessionAccess(db, sessionId, tenantId, userId);

  async function requireSession(c: Context<HonoEnv>, minimum: SessionRole = 'viewer') {
    const sessionId = c.req.param('id') ?? '';
    if (!UUID_RE.test(sessionId)) return null;
    const access = await membership(sessionId, c.get('tenantId') as number, c.get('userId') as string);
    if (!access || ROLE_RANK[access.role as SessionRole] < ROLE_RANK[minimum]) return null;
    return access;
  }

  async function visibleGraph(
    sessionId: string,
    tenantId: number,
    segmentId: string | null,
    userId: string,
  ) {
    const [objects, connections] = await Promise.all([
      db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, sessionId)),
      db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, sessionId)),
    ]);
    const referenced: GraphObjectInput[] = objects.map((object) => ({
      id: object.id, kind: object.kind, resourceType: object.resourceType, resourceId: object.resourceId,
      resourceRevision: object.resourceRevision, canvasData: object.canvasData, content: object.content,
    }));
    const graphDenied = await validateResourceAccess(referenced, tenantId, segmentId, userId);
    if (!graphDenied) return { objects, connections };
    const visibleObjects = await Promise.all(objects.map(async (object) => {
      if (!object.resourceType || !object.resourceId) return object;
      const denied = await validateResourceAccess([{
        id: object.id, kind: object.kind, resourceType: object.resourceType, resourceId: object.resourceId,
        resourceRevision: object.resourceRevision, canvasData: object.canvasData, content: object.content,
      }], tenantId, segmentId, userId);
      if (!denied) return object;
      return {
        ...object,
        resourceId: null,
        resourceRevision: null,
        searchText: '',
        content: { kind: object.kind, title: 'Access required', status: 'Permission missing', redacted: true, canRequestAccess: true },
      };
    }));
    const visibleIds = new Set(visibleObjects.map((object) => object.id));
    return {
      objects: visibleObjects,
      connections: connections.filter((edge) => visibleIds.has(edge.sourceObjectId) && visibleIds.has(edge.targetObjectId)),
    };
  }

  async function creationPlan(tenantId: number): Promise<TenantPlan> {
    const [tenant] = await db.select({
      plan: tenants.plan,
      billingStatus: tenants.billingStatus,
      trialEndsAt: tenants.trialEndsAt,
    }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return tenant ? resolveEffectivePlan({
      plan: tenant.plan as TenantPlan,
      billingStatus: tenant.billingStatus as TenantBillingStatus,
      trialEndsAt: tenant.trialEndsAt,
    }) : TenantPlan.FREE;
  }

  async function creationLimits(tenantId: number): Promise<PlanLimits> {
    return getLimits(await creationPlan(tenantId));
  }

  async function countRows(tableName: 'creation_sessions' | 'creation_session_members' | 'creation_session_templates', clause: ReturnType<typeof sql>): Promise<number> {
    const result = await db.execute(sql.raw(`SELECT COUNT(*)::int AS count FROM ${tableName} WHERE `).append(clause));
    return Number((result.rows[0] as { count?: number } | undefined)?.count ?? 0);
  }

  async function sessionQuota(c: Context<HonoEnv>, tenantId: number) {
    const currentPlan = await creationPlan(tenantId);
    const limits = getLimits(currentPlan);
    const used = await countRows('creation_sessions', sql`tenant_id = ${tenantId} AND status <> 'deleted'`);
    return resolveCreationSessionQuota({
      used,
      planLimit: limits.maxCreationSessions,
      currentPlan,
      isSuperadmin: await resolveIsSuperadmin(c.env, c.get('userId') as string),
    });
  }

  async function pruneHistory(sessionId: string, tenantId: number) {
    const limit = (await creationLimits(tenantId)).maxCreationSessionHistory;
    if (limit === -1) return;
    await db.execute(sql`
      DELETE FROM creation_session_snapshots
      WHERE session_id = ${sessionId}
        AND label IS NULL
        AND revision NOT IN (
          SELECT revision FROM creation_session_snapshots
          WHERE session_id = ${sessionId}
          ORDER BY revision DESC LIMIT ${limit}
        )
    `);
  }

  async function canonicalLockConflict(sessionId: string, userId: string, incoming: GraphObjectInput[]) {
    const active = await db.select({ id: creationSessionObjects.id, content: creationSessionObjects.content, lockedBy: creationSessionObjects.lockedBy, lockExpiresAt: creationSessionObjects.lockExpiresAt })
      .from(creationSessionObjects).where(and(eq(creationSessionObjects.sessionId, sessionId), gte(creationSessionObjects.lockExpiresAt, new Date())));
    for (const locked of active) {
      if (!locked.lockedBy || locked.lockedBy === userId) continue;
      const candidate = incoming.find((object) => object.id === locked.id);
      if (!candidate || JSON.stringify(candidate.content ?? null) !== JSON.stringify(locked.content ?? null)) return locked;
    }
    return null;
  }

  async function notifyAttention(c: Context<HonoEnv>, sessionId: string, input: { kind: string; title: string; body?: string; directUserIds?: string[]; allWatchers?: boolean }) {
    const actorId = c.get('userId') as string;
    const members = await db.select({ userId: creationSessionMembers.userId, watchState: creationSessionMembers.watchState }).from(creationSessionMembers).where(eq(creationSessionMembers.sessionId, sessionId));
    const direct = new Set(input.directUserIds ?? []);
    const recipients = members.filter((member) => member.userId !== actorId && (direct.has(member.userId) || (input.allWatchers && member.watchState === 'all')));
    await Promise.all(recipients.map((member) => notify(db, c.env, {
      userId: member.userId,
      tenantId: c.get('tenantId') as number,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      ref: `/create/${sessionId}`,
    })));
  }

  /**
   * A session permission never grants access to the resources placed inside it.
   * Validate every authoritative reference against the active tenant before a
   * graph replacement is committed. Canvas-native drafts have no resource ref.
   */
  async function validateResourceAccess(
    objects: GraphObjectInput[],
    tenantId: number,
    segmentId: string | null,
    userId: string,
  ): Promise<string | null> {
    if (!segmentId) return 'This session is missing its workspace segment';
    const refs = objects.filter((object) => object.resourceType && object.resourceId);
    const ids = (type: string) => [...new Set(refs.filter((object) => object.resourceType === type).map((object) => object.resourceId as string))];
    const numericIds = (type: string) => ids(type).map(Number).filter((id) => Number.isInteger(id) && id > 0);

    const projectIds = numericIds('project');
    if (projectIds.length !== ids('project').length) return 'A Project reference is invalid';
    if (projectIds.length) {
      const found = await db.select({ id: projects.id }).from(projects).where(and(
        eq(projects.tenantId, tenantId), eq(projects.segmentId, segmentId), inArray(projects.id, projectIds),
      ));
      if (found.length !== projectIds.length) return 'A Project is unavailable or belongs to another workspace';
    }

    const taskIds = numericIds('task');
    if (taskIds.length !== ids('task').length) return 'A Task reference is invalid';
    if (taskIds.length) {
      const found = await db.select({ id: tasks.id }).from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(projects.tenantId, tenantId), eq(tasks.segmentId, segmentId), inArray(tasks.id, taskIds)));
      if (found.length !== taskIds.length) return 'A Task is unavailable or belongs to another workspace';
    }

    const workflowIds = ids('workflow');
    if (workflowIds.length) {
      if (workflowIds.some((id) => !UUID_RE.test(id))) return 'A Workflow reference is invalid';
      const [definitions, executions] = await Promise.all([
        db.select({ id: workflowDefinitions.id }).from(workflowDefinitions).where(and(
          eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.segmentId, segmentId), inArray(workflowDefinitions.id, workflowIds),
        )),
        db.select({ id: workflows.id }).from(workflows).where(and(
          eq(workflows.tenantId, tenantId), eq(workflows.segmentId, segmentId), inArray(workflows.id, workflowIds),
        )),
      ]);
      if (new Set([...definitions, ...executions].map((row) => row.id)).size !== workflowIds.length) return 'A Workflow is unavailable or belongs to another workspace';
    }

    for (const chatId of ids('chat')) {
      const numeric = Number(chatId);
      if (!Number.isInteger(numeric) || !(await resolveChatAccess(db, { chatId: numeric, userId, tenantId }))) {
        return 'A Chat is unavailable or belongs to another workspace';
      }
    }

    const agentIds = ids('agent');
    if (agentIds.length) {
      const numeric = agentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
      const text = agentIds.filter((id) => !numeric.includes(Number(id)));
      const [legacy, workforce] = await Promise.all([
        numeric.length ? db.select({ id: agents.id }).from(agents).where(and(eq(agents.tenantId, tenantId), eq(agents.segmentId, segmentId), inArray(agents.id, numeric))) : Promise.resolve([]),
        text.length ? db.select({ id: ideAgents.id }).from(ideAgents).where(and(eq(ideAgents.tenantId, tenantId), inArray(ideAgents.id, text))) : Promise.resolve([]),
      ]);
      if (legacy.length + workforce.length !== agentIds.length) return 'An Agent is unavailable or belongs to another workspace';
    }

    const ceremonyIds = ids('ceremony');
    if (ceremonyIds.length) {
      if (ceremonyIds.some((id) => !UUID_RE.test(id))) return 'A ceremony reference is invalid';
      const found = await db.select({ id: ceremonySessions.id }).from(ceremonySessions).where(and(
        eq(ceremonySessions.tenantId, tenantId), eq(ceremonySessions.segmentId, segmentId), inArray(ceremonySessions.id, ceremonyIds),
      ));
      if (found.length !== ceremonyIds.length) return 'A ceremony is unavailable or belongs to another workspace';
    }

    const staffIds = ids('staff');
    if (staffIds.length) {
      const found = await db.select({ userId: tenantMembers.userId }).from(tenantMembers).where(and(
        eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.userId, staffIds),
      ));
      if (found.length !== staffIds.length) return 'A staff member is unavailable or belongs to another workspace';
    }
    return null;
  }

  router.get('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const status = c.req.query('status') === 'archived' ? 'archived' : 'active';
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 30)));
    const rows = await db
      .select({
        id: creationSessions.id,
        title: creationSessions.title,
        description: creationSessions.description,
        folder: creationSessions.folder,
        status: creationSessions.status,
        preview: creationSessions.preview,
        revision: creationSessions.canvasRevision,
        lastActivityAt: creationSessions.lastActivityAt,
        createdAt: creationSessions.createdAt,
        role: creationSessionMembers.role,
        pinned: creationSessionMembers.pinned,
        unread: sql<boolean>`${creationSessionMembers.lastSeenRevision} < ${creationSessions.canvasRevision}`,
        collaboratorCount: sql<number>`(SELECT COUNT(*)::int FROM creation_session_members member_count WHERE member_count.session_id = ${creationSessions}.id)`,
        projectIds: sql<number[]>`COALESCE((SELECT array_agg(project_id ORDER BY project_id) FROM creation_session_project_links project_link WHERE project_link.session_id = ${creationSessions}.id), ARRAY[]::integer[])`,
      })
      .from(creationSessions)
      .innerJoin(creationSessionMembers, and(
        eq(creationSessionMembers.sessionId, creationSessions.id),
        eq(creationSessionMembers.userId, userId),
      ))
      .where(and(
        eq(creationSessions.tenantId, tenantId),
        eq(creationSessions.segmentId, segmentId),
        eq(creationSessions.status, status),
      ))
      .orderBy(desc(creationSessions.lastActivityAt))
      .limit(limit);
    return c.json({ sessions: rows });
  });

  router.get('/quotas', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const limits = await creationLimits(tenantId);
    const [sessions, templates] = await Promise.all([
      countRows('creation_sessions', sql`tenant_id = ${tenantId} AND status <> 'deleted'`),
      countRows('creation_session_templates', sql`tenant_id = ${tenantId} AND segment_id = ${segmentId}`),
    ]);
    const isSuperadmin = await resolveIsSuperadmin(c.env, c.get('userId') as string);
    return c.json({
      usage: { sessions, templates },
      limits: {
        sessions: isSuperadmin ? -1 : limits.maxCreationSessions,
        collaboratorsPerSession: limits.maxCreationSessionCollaborators,
        templates: limits.maxCreationSessionTemplates,
        historyPerSession: limits.maxCreationSessionHistory,
        datasetRows: limits.maxCreationDatasetRows,
        realtimeEditors: limits.maxCreationRealtimeEditors,
        artifactBytesPerSession: limits.maxCreationArtifactBytes,
      },
    });
  });

  router.get('/search', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const q = (c.req.query('q') ?? '').trim().slice(0, 200);
    if (q.length < 2) return c.json({ sessions: [] });
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const status = creationSessionSearchStatus(c.req.query('status'));
    const kind = (c.req.query('kind') ?? '').trim().slice(0, 48);
    const projectId = Number(c.req.query('projectId'));
    const collaborator = (c.req.query('collaborator') ?? '').trim().slice(0, 200);
    const pinned = c.req.query('pinned');
    const shared = c.req.query('shared');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const fromDate = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : null;
    const toDate = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : null;
    const rows = await db.select({
      id: creationSessions.id,
      title: creationSessions.title,
      description: creationSessions.description,
      folder: creationSessions.folder,
      status: creationSessions.status,
      preview: creationSessions.preview,
      revision: creationSessions.canvasRevision,
      lastActivityAt: creationSessions.lastActivityAt,
      role: creationSessionMembers.role,
      pinned: creationSessionMembers.pinned,
      matchingObjectId: sql<string | null>`(
        SELECT object_match.id FROM creation_session_objects object_match
        WHERE object_match.session_id = ${creationSessions.id}
          AND object_match.search_text ILIKE ${pattern} ESCAPE '\\'
        ORDER BY object_match.updated_at DESC LIMIT 1
      )`,
    }).from(creationSessions)
      .innerJoin(creationSessionMembers, and(
        eq(creationSessionMembers.sessionId, creationSessions.id),
        eq(creationSessionMembers.userId, userId),
      ))
      .where(and(
        eq(creationSessions.tenantId, tenantId),
        eq(creationSessions.segmentId, segmentId),
        status === 'all'
          ? undefined
          : eq(creationSessions.status, status),
        or(
          ilike(creationSessions.title, pattern),
          ilike(creationSessions.description, pattern),
          ilike(creationSessions.status, pattern),
          sql`EXISTS (SELECT 1 FROM creation_session_objects searchable WHERE searchable.session_id = ${creationSessions}.id AND searchable.search_text ILIKE ${pattern} ESCAPE '\\')`,
          sql`EXISTS (SELECT 1 FROM creation_session_project_links searchable_project JOIN projects searchable_project_record ON searchable_project_record.id = searchable_project.project_id WHERE searchable_project.session_id = ${creationSessions}.id AND (searchable_project.project_id::text ILIKE ${pattern} ESCAPE '\\' OR searchable_project_record.name ILIKE ${pattern} ESCAPE '\\'))`,
          sql`EXISTS (SELECT 1 FROM creation_session_members searchable_member JOIN users searchable_user ON searchable_user.id = searchable_member.user_id WHERE searchable_member.session_id = ${creationSessions}.id AND searchable_user.display_name ILIKE ${pattern} ESCAPE '\\')`,
        ),
        kind ? sql`EXISTS (SELECT 1 FROM creation_session_objects kind_filter WHERE kind_filter.session_id = ${creationSessions}.id AND kind_filter.kind = ${kind})` : undefined,
        Number.isInteger(projectId) && projectId > 0 ? sql`EXISTS (SELECT 1 FROM creation_session_project_links project_filter WHERE project_filter.session_id = ${creationSessions}.id AND project_filter.project_id = ${projectId})` : undefined,
        collaborator ? sql`EXISTS (SELECT 1 FROM creation_session_members collaborator_filter JOIN users collaborator_user ON collaborator_user.id = collaborator_filter.user_id WHERE collaborator_filter.session_id = ${creationSessions}.id AND collaborator_user.display_name ILIKE ${`%${collaborator}%`})` : undefined,
        pinned === 'true' ? eq(creationSessionMembers.pinned, true) : pinned === 'false' ? eq(creationSessionMembers.pinned, false) : undefined,
        shared === 'true' ? sql`(SELECT COUNT(*) FROM creation_session_members shared_filter WHERE shared_filter.session_id = ${creationSessions}.id) > 1` : shared === 'false' ? sql`(SELECT COUNT(*) FROM creation_session_members shared_filter WHERE shared_filter.session_id = ${creationSessions}.id) = 1` : undefined,
        fromDate ? gte(creationSessions.lastActivityAt, fromDate) : undefined,
        toDate ? sql`${creationSessions.lastActivityAt} <= ${toDate}` : undefined,
      ))
      .orderBy(desc(creationSessionMembers.pinned), desc(creationSessions.lastActivityAt))
      .limit(Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 30))));
    // Search matches are only hints. Revalidate every authoritative resource
    // represented in the preview because access can be revoked after insertion.
    const safeRows = await Promise.all(rows.map(async (row) => {
      const referencedObjects = await db.select({
        id: creationSessionObjects.id,
        kind: creationSessionObjects.kind,
        resourceType: creationSessionObjects.resourceType,
        resourceId: creationSessionObjects.resourceId,
        resourceRevision: creationSessionObjects.resourceRevision,
        canvasData: creationSessionObjects.canvasData,
        content: creationSessionObjects.content,
      }).from(creationSessionObjects).where(and(
        eq(creationSessionObjects.sessionId, row.id),
        sql`${creationSessionObjects.resourceType} IS NOT NULL`,
        sql`${creationSessionObjects.resourceId} IS NOT NULL`,
      ));
      if (!referencedObjects.length) return row;
      const graphDenied = await validateResourceAccess(referencedObjects, tenantId, segmentId, userId);
      if (!graphDenied) return row;
      const deniedIds = new Set((await Promise.all(referencedObjects.map(async (object) => (
        await validateResourceAccess([object], tenantId, segmentId, userId) ? object.id : null
      )))).filter((id): id is string => !!id));
      if (!deniedIds.size) return row;
      const preview = row.preview && typeof row.preview === 'object'
        ? row.preview as { objects?: Array<{ id?: string }>; [key: string]: unknown }
        : null;
      return {
        ...row,
        matchingObjectId: row.matchingObjectId && deniedIds.has(row.matchingObjectId) ? null : row.matchingObjectId,
        preview: preview ? {
          ...preview,
          objects: Array.isArray(preview.objects)
            ? preview.objects.filter((item) => !item.id || !deniedIds.has(item.id))
            : [],
        } : null,
      };
    }));
    return c.json({ sessions: safeRows });
  });

  router.get('/templates', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const templates = await db.select().from(creationSessionTemplates).where(and(
      eq(creationSessionTemplates.tenantId, tenantId),
      eq(creationSessionTemplates.segmentId, segmentId),
      or(eq(creationSessionTemplates.visibility, 'tenant'), eq(creationSessionTemplates.createdBy, userId)),
    )).orderBy(desc(creationSessionTemplates.updatedAt));
    return c.json({ builtInIds: BUILT_IN_TEMPLATE_IDS, templates });
  });

  router.post('/templates', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const body = await c.req.json<TemplateBody>().catch(() => ({} as TemplateBody));
    const graph = parseTemplateGraph(body.graph);
    const name = cleanTitle(body.name, 'Untitled template').slice(0, 160);
    if (!graph) return c.json({ error: 'A valid template graph is required' }, 400);
    const resourceError = await validateResourceAccess(graph.objects, tenantId, segmentId, userId);
    if (resourceError) return c.json({ error: resourceError, code: 'RESOURCE_ACCESS_DENIED' }, 403);
    const limits = await creationLimits(tenantId);
    const used = await countRows('creation_session_templates', sql`tenant_id = ${tenantId} AND segment_id = ${segmentId}`);
    if (limits.maxCreationSessionTemplates !== -1 && used >= limits.maxCreationSessionTemplates) {
      return c.json({ error: 'Template limit reached', code: 'CREATION_TEMPLATE_QUOTA', usage: used, limit: limits.maxCreationSessionTemplates }, 403);
    }
    const id = crypto.randomUUID();
    await db.insert(creationSessionTemplates).values({
      id, tenantId, segmentId, name,
      description: typeof body.description === 'string' ? body.description.trim().slice(0, 2_000) : null,
      category: typeof body.category === 'string' ? body.category.trim().slice(0, 80) || 'Custom' : 'Custom',
      visibility: body.visibility === 'tenant' ? 'tenant' : 'private',
      graph, createdBy: userId, updatedBy: userId,
    });
    return c.json({ template: { id, name } }, 201);
  });

  router.delete('/templates/:templateId', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const templateId = c.req.param('templateId');
    if (!UUID_RE.test(templateId)) return c.json({ error: 'Invalid template id' }, 400);
    const [owned] = await db.select({ id: creationSessionTemplates.id }).from(creationSessionTemplates).where(and(
      eq(creationSessionTemplates.id, templateId), eq(creationSessionTemplates.tenantId, tenantId),
      eq(creationSessionTemplates.segmentId, segmentId), eq(creationSessionTemplates.createdBy, userId),
    )).limit(1);
    if (!owned) return c.json({ error: 'Template not found or not editable' }, 404);
    await db.delete(creationSessionTemplates).where(and(
      eq(creationSessionTemplates.id, templateId),
      eq(creationSessionTemplates.tenantId, tenantId),
      eq(creationSessionTemplates.segmentId, segmentId),
    ));
    return c.body(null, 204);
  });

  router.post('/claim', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const body = await c.req.json<ClaimSessionBody>().catch(() => ({} as ClaimSessionBody));
    const clientSessionId = typeof body.clientSessionId === 'string' ? body.clientSessionId.trim().slice(0, 80) : '';
    if (!/^local-[0-9a-f-]{36}$/i.test(clientSessionId)) return c.json({ error: 'A valid local Session id is required' }, 400);
    const [prior] = await db.select({ sessionId: creationSessionClaims.serverSessionId }).from(creationSessionClaims).where(and(eq(creationSessionClaims.userId, userId), eq(creationSessionClaims.clientSessionId, clientSessionId))).limit(1);
    if (prior) return c.json({ session: { id: prior.sessionId, claimed: true, replayed: true } });
    const localObjects = Array.isArray(body.objects) ? body.objects : [];
    const localConnections = sanitizeClaimConnectionIds(Array.isArray(body.connections) ? body.connections : []);
    const graphError = validCreationGraph(localObjects, localConnections);
    if (graphError) return c.json({ error: graphError }, 400);
    const resourceError = await validateResourceAccess(localObjects, tenantId, segmentId, userId);
    if (resourceError) return c.json({ error: resourceError, code: 'RESOURCE_ACCESS_DENIED' }, 403);
    const quota = await sessionQuota(c, tenantId);
    if (!quota.allowed) return c.json(creationSessionQuotaError(quota), 402);
    const { objects, connections } = durableCreationGraph(localObjects, localConnections);
    const sessionId = crypto.randomUUID();
    const title = cleanTitle(body.title, 'Untitled session');
    // A LABELLED inventory rather than a bare array: `db.batch` on neon-http
    // reports one Postgres message for the whole batch with no statement index,
    // so the only way the catch below can say WHICH write failed is to know what
    // it was about to run and in what order. See `pgFailureDetail`.
    const planned: PlannedClaimWrite[] = [
      ...newCreationSessionStatements(db, {
        sessionId, tenantId, segmentId, title, objects, connections, authorUserId: userId,
        eventType: 'session.claimed',
        eventPayload: { clientSessionId, hadInitialPrompt: !!body.initialPrompt },
        viewport: body.viewport ?? { x: 0, y: 0, zoom: 1 },
        memberViewport: body.viewport ?? { x: 0, y: 0, zoom: 1 },
      }),
      { table: 'creation_session_claims', rows: 1, statement: db.insert(creationSessionClaims).values({ userId, clientSessionId, serverSessionId: sessionId }) },
    ];
    const claimedTimeline = Array.isArray(body.timeline) ? body.timeline.slice(0, 500).flatMap((message) => {
      const text = typeof message.body === 'string' ? message.body.trim().slice(0, 50_000) : '';
      if (!text) return [];
      const messageRole = message.role === 'assistant' || message.role === 'system' ? message.role : 'user';
      const rawMeta = message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata) ? message.metadata as Record<string, unknown> : {};
      const author = rawMeta.authoredBy && typeof rawMeta.authoredBy === 'object' && !Array.isArray(rawMeta.authoredBy) ? rawMeta.authoredBy as Record<string, unknown> : null;
      const metadata = author ? { authoredBy: {
        kind: author.kind === 'agent' ? 'agent' : 'brain',
        ref: String(author.ref || '').slice(0, 128),
        name: String(author.name || '').slice(0, 160),
      } } : {};
      return [{ sessionId, clientMessageId: String(message.clientMessageId || crypto.randomUUID()).slice(0, 128), messageRole, body: text, metadata, createdBy: userId }];
    }) : [];
    if (!claimedTimeline.length && typeof body.initialPrompt === 'string' && body.initialPrompt.trim()) claimedTimeline.push({ sessionId, clientMessageId: `claim:${clientSessionId}`, messageRole: 'user', body: body.initialPrompt.trim().slice(0, 50_000), metadata: {}, createdBy: userId });
    if (claimedTimeline.length) planned.push({ table: 'creation_session_timeline', rows: claimedTimeline.length, statement: db.insert(creationSessionTimeline).values(claimedTimeline) });
    try {
      await db.batch(planned.map((write) => write.statement) as unknown as Parameters<typeof db.batch>[0]);
    } catch (error) {
      const [raced] = await db.select({ sessionId: creationSessionClaims.serverSessionId }).from(creationSessionClaims).where(and(eq(creationSessionClaims.userId, userId), eq(creationSessionClaims.clientSessionId, clientSessionId))).limit(1);
      if (raced) return c.json({ session: { id: raced.sessionId, claimed: true, replayed: true } });
      // NOT a race, so this is the 500 the operator screenshotted. Everything the
      // driver refuses to say is reconstructed here BEFORE the rethrow: which
      // statement the named constraint belongs to, how many rows it carried, and
      // whether the ids the caller sent were distinct case-sensitively but not
      // case-INSENSITIVELY. That last pair is the one cause of
      // creation_session_objects_pkey that has actually been found and fixed, and
      // nothing could previously confirm or rule it out for a given request.
      reportCaughtError(error, {
        source: 'application/creation/creationSessionRouteService.ts',
        operation: 'claimCreationSession',
        context: {
          ...describeClaimBatchFailure(error, planned),
          objectIds: distinctIdCounts(objects.map((object) => object.id)),
          connectionIds: distinctIdCounts(connections.map((edge) => edge.id)),
          timelineRows: claimedTimeline.length,
          clientSessionId,
        },
      });
      throw error;
    }
    return c.json({ session: { id: sessionId, title, revision: 1, claimed: true } }, 201);
  });

  /**
   * IS THIS ADDRESS FREE? — the check a creator types into before committing.
   *
   * Declared before `/:id` because Hono matches in registration order and a
   * later literal route loses to an earlier parameterised one.
   *
   * Deliberately uncached: it is a live uniqueness question whose answer is
   * acted on immediately, and a cached "available" that survives somebody else
   * claiming the name tells the creator they have it and then fails the publish.
   */
  router.get('/address-available', async (c) => {
    const label = (c.req.query('label') ?? '').slice(0, 80);
    if (!label.trim()) return c.json({ error: 'A label is required.' }, 400);
    const availability = await checkSubdomainAvailability(db, label, null);
    return c.json(availability);
  });

  /**
   * IS THIS BOARD AN APP? — the narrow answer, without the graph.
   *
   * `app` also rides `GET /:id`, which is right for the canvas because it makes
   * that read anyway. It used to be the ONLY place, so anything else that wanted
   * the four-field answer — the convert panel, a board list, a share sheet — had
   * to fetch every object, connection, member and viewport to get it. This is
   * the same three-table join, read through the platform cache, and nothing else.
   *
   * Viewer+ deliberately: "what did this board become" is not privileged beyond
   * being able to see the board at all, and the convert surface has to answer it
   * for a reader who may not convert.
   *
   * `role` and `title` ride along because the one surface that asks this needs
   * all three to decide its own state, and three requests to render one button
   * is the shape this route exists to remove.
   */
  router.get('/:id/app', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const app = await cachedAppForSession(db, c.env, access.session.tenantId, access.session.id);
    return c.json({ app, role: access.role, title: access.session.title });
  });

  /**
   * MAKE THIS BOARD AN APP.
   *
   * Editor+ because it changes what the board IS, not merely what it contains.
   * Idempotent: a board that is already an app returns that app rather than
   * making a second one, so a double-clicked button costs nothing.
   */
  router.post('/:id/convert-to-app', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or not editable' }, 404);
    const body = await c.req.json<{ label?: unknown }>().catch(() => ({}) as never);
    const result = await convertSessionToApp(db, c.env, {
      tenantId: access.session.tenantId,
      userId: c.get('userId') as string,
      sessionId: access.session.id,
      label: typeof body.label === 'string' ? body.label : null,
    });
    if (!result.ok) {
      return c.json({ error: result.error, availability: result.availability ?? null }, result.status);
    }
    return c.json({ app: result.app }, result.app.created ? 201 : 200);
  });

  router.post('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const body = await c.req.json<CreateSessionBody>().catch(() => ({} as CreateSessionBody));
    const requestKey = c.req.header('Idempotency-Key')?.trim().slice(0, 128) || '';
    const requestClaimId = requestKey ? `request:${requestKey}` : '';
    if (requestClaimId) {
      const [prior] = await db.select({ id: creationSessions.id, title: creationSessions.title, revision: creationSessions.canvasRevision })
        .from(creationSessionClaims).innerJoin(creationSessions, eq(creationSessions.id, creationSessionClaims.serverSessionId))
        .where(and(eq(creationSessionClaims.userId, userId), eq(creationSessionClaims.clientSessionId, requestClaimId))).limit(1);
      if (prior) return c.json({ session: prior, replayed: true });
    }
    const quota = await sessionQuota(c, tenantId);
    if (!quota.allowed) return c.json(creationSessionQuotaError(quota), 402);
    const sessionId = crypto.randomUUID();
    const projectIds = [...new Set((body.projectIds ?? []).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 20);
    const validProjects = projectIds.length
      ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.tenantId, tenantId), inArray(projects.id, projectIds)))
      : [];
    if (validProjects.length !== projectIds.length) return c.json({ error: 'One or more projects were not found' }, 404);

    const initialPrompt = typeof body.initialPrompt === 'string' ? body.initialPrompt.trim().slice(0, 20_000) : '';
    const objectRows: Array<typeof creationSessionObjects.$inferInsert> = [];
    const connectionRows: Array<typeof creationSessionConnections.$inferInsert> = [];
    validProjects.forEach((project, index) => objectRows.push({
      id: crypto.randomUUID(), sessionId, kind: 'project', resourceType: 'project', resourceId: String(project.id),
      canvasData: { x: 120 + index * 360, y: 100, w: 300, h: 220 }, content: { title: project.name }, createdBy: userId, updatedBy: userId,
    }));
    if (initialPrompt) {
      const chatObjectId = crypto.randomUUID();
      objectRows.push({
      id: chatObjectId, sessionId, kind: 'chat', resourceType: null, resourceId: null,
      canvasData: { x: 120, y: validProjects.length ? 380 : 100, w: 320, h: 300 },
      content: { kind: 'chat', title: 'Brain', subtitle: initialPrompt, messages: [{ role: 'user', content: initialPrompt, createdAt: new Date().toISOString() }] },
      createdBy: userId, updatedBy: userId,
      });
      const lower = initialPrompt.toLowerCase();
      const addIntent = (kind: string, title: string, x: number, y: number) => {
        const id = crypto.randomUUID();
        objectRows.push({ id, sessionId, kind, canvasData: { x, y, w: 360, h: 260 }, content: { kind, title, status: 'AI draft', subtitle: `Created from: ${initialPrompt}` }, createdBy: userId, updatedBy: userId });
        connectionRows.push({ id: crypto.randomUUID(), sessionId, sourceObjectId: chatObjectId, targetObjectId: id, kind: 'reference', label: 'creates', createdBy: userId });
        return id;
      };
      const title = cleanTitle(body.title, initialPrompt.slice(0, 80));
      if (/website|landing page|web app|prototype/.test(lower)) addIntent('website', title, 570, 80);
      if (/workflow|campaign|automation|process/.test(lower)) addIntent('workflow', `${title} workflow`, 570, 390);
      if (/data|dataset|csv|spreadsheet|report|dashboard|chart/.test(lower)) {
        const datasetId = addIntent('dataset', 'Imported data', 570, 120);
        const dashboardId = crypto.randomUUID();
        objectRows.push({ id: dashboardId, sessionId, kind: 'dashboard', canvasData: { x: 1050, y: 120, w: 360, h: 260 }, content: { kind: 'dashboard', title: `${title} dashboard`, status: 'AI draft' }, createdBy: userId, updatedBy: userId });
        connectionRows.push({ id: crypto.randomUUID(), sessionId, sourceObjectId: datasetId, targetObjectId: dashboardId, kind: 'data', label: 'visualizes', createdBy: userId });
      }
    }

    const graph = {
      objects: objectRows.map((object) => ({ id: object.id, kind: object.kind, resourceType: object.resourceType, resourceId: object.resourceId, canvasData: object.canvasData, content: object.content })),
      connections: connectionRows.map((edge) => ({ id: edge.id, sourceObjectId: edge.sourceObjectId, targetObjectId: edge.targetObjectId, kind: edge.kind, label: edge.label, metadata: edge.metadata })),
    };
    const statements: unknown[] = newCreationSessionStatements(db, {
      sessionId, tenantId, segmentId,
      title: cleanTitle(body.title, initialPrompt ? initialPrompt.slice(0, 80) : 'Untitled session'),
      objects: graph.objects as GraphObjectInput[],
      connections: graph.connections as GraphConnectionInput[],
      authorUserId: userId,
      eventType: 'session.created',
      eventPayload: { initialPrompt: !!initialPrompt, projectIds: validProjects.map((project) => project.id) },
      idempotencyKey: requestKey || null,
      columns: { description: typeof body.description === 'string' ? body.description.slice(0, 2_000) : null },
    }).map((write) => write.statement);
    if (requestClaimId) statements.push(db.insert(creationSessionClaims).values({ userId, clientSessionId: requestClaimId, serverSessionId: sessionId }));
    if (validProjects.length) statements.push(db.insert(creationSessionProjectLinks).values(validProjects.map((project) => ({ sessionId, projectId: project.id, addedBy: userId }))));
    if (initialPrompt) statements.push(db.insert(creationSessionTimeline).values({ sessionId, clientMessageId: `initial:${requestKey || sessionId}`, messageRole: 'user', body: initialPrompt, createdBy: userId }));
    try {
      await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    } catch (error) {
      if (requestClaimId) {
        const [raced] = await db.select({ id: creationSessions.id, title: creationSessions.title, revision: creationSessions.canvasRevision })
          .from(creationSessionClaims).innerJoin(creationSessions, eq(creationSessions.id, creationSessionClaims.serverSessionId))
          .where(and(eq(creationSessionClaims.userId, userId), eq(creationSessionClaims.clientSessionId, requestClaimId))).limit(1);
        if (raced) return c.json({ session: raced, replayed: true });
      }
      throw error;
    }
    c.executionCtx.waitUntil(bumpPublicCanvasVersion(c.env, tenantId));
    return c.json({ session: { id: sessionId, title: cleanTitle(body.title, initialPrompt ? initialPrompt.slice(0, 80) : 'Untitled session'), revision: 1 } }, 201);
  });

  router.get('/:id', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const [graph, projectLinks, members, app] = await Promise.all([
      visibleGraph(access.session.id, access.session.tenantId, access.session.segmentId, c.get('userId') as string),
      // Every link, both kinds: this is a READ of what the board relates to, not
      // a copy, so the app link belongs in it.
      db.select({ projectId: creationSessionProjectLinks.projectId }).from(creationSessionProjectLinks).where(eq(creationSessionProjectLinks.sessionId, access.session.id)),
      db.select({ userId: creationSessionMembers.userId, role: creationSessionMembers.role, displayName: users.displayName, lastSeenAt: creationSessionMembers.lastSeenAt, viewport: creationSessionMembers.viewport, cursor: creationSessionMembers.cursor, selection: creationSessionMembers.selection, typing: creationSessionMembers.typing, watchState: creationSessionMembers.watchState, followingUserId: creationSessionMembers.followingUserId })
        .from(creationSessionMembers).leftJoin(users, eq(users.id, creationSessionMembers.userId))
        .where(eq(creationSessionMembers.sessionId, access.session.id)),
      // The app this board became, if it became one. Rides the session read so
      // the convert action can decide its own state without a second request.
      appForSession(db, access.session.tenantId, access.session.id),
    ]);
    const currentMember = members.find((member) => member.userId === c.get('userId'));
    return c.json({ session: access.session, role: access.role, currentUserId: c.get('userId'), objects: graph.objects, connections: graph.connections, projectIds: projectLinks.map((p) => p.projectId), app, members, personalViewport: currentMember?.viewport ?? access.session.viewport });
  });

  /**
   * Record one correlated outcome.
   *
   * The ledger insert itself belongs to `application/outcomes/outcomeLedger.ts`
   * — the proof lifecycle writes through the same port — so what stays here is
   * the part that is genuinely about THIS session: who is allowed to record
   * what, and the rule that a project id is accepted only when it is actually
   * linked to the board. Tenant and user identity are derived from the proven
   * session, never read off the body.
   */
  router.post('/:id/outcomes', async (c) => {
    const access = await requireSession(c, 'viewer');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const body = await c.req.json<OutcomeBody>().catch(() => ({} as OutcomeBody));
    const correlationId = typeof body.correlationId === 'string' ? body.correlationId.trim().slice(0, 128) : '';
    const action = normalizeOutcomeAction(body.action);
    if (!correlationId || !action || !isOutcomePhase(body.phase)) return c.json({ error: 'correlationId, action, and a valid phase are required' }, 400);
    if (action !== 'session.open' && ROLE_RANK[access.role as SessionRole] < ROLE_RANK.editor) return c.json({ error: 'Session role cannot record this outcome' }, 403);
    const actorType = action === 'session.open' ? 'user' : body.actorType === 'agent' || body.actorType === 'brain' || body.actorType === 'system' ? body.actorType : 'user';
    const projectId = Number.isInteger(body.projectId) && Number(body.projectId) > 0 ? Number(body.projectId) : null;
    if (projectId != null) {
      const [linked] = await db.select({ projectId: creationSessionProjectLinks.projectId }).from(creationSessionProjectLinks).where(and(
        eq(creationSessionProjectLinks.sessionId, access.session.id), eq(creationSessionProjectLinks.projectId, projectId),
      )).limit(1);
      if (!linked) return c.json({ error: 'Project is not linked to this session' }, 400);
    }
    const recorded = await recordOutcomeEvent(db, {
      correlationId,
      sessionId: access.session.id,
      tenantId: access.session.tenantId,
      projectId,
      actorType,
      actorRef: actorType === 'user' ? c.get('userId') as string : typeof body.actorRef === 'string' ? body.actorRef : null,
      action,
      phase: body.phase,
      metricKey: body.metricKey ?? null,
      metricValue: body.metricValue ?? null,
      unit: body.unit ?? null,
      artifactId: body.artifactId ?? null,
      durationMs: body.durationMs ?? null,
      costUsdMillicents: body.costUsdMillicents ?? null,
      metadata: body.metadata,
    });
    return c.json({ recorded, duplicate: !recorded }, recorded ? 201 : 200);
  });

  /**
   * The session scorecard: this board's numbers against an aggregate baseline
   * of its workspace.
   *
   * Both halves come from `application/outcomes/outcomeMetricContract.ts`, and
   * that is the whole point of the module existing. This route used to carry
   * its own copy of every metric and averaged the PER-SESSION RATES of its
   * peers to make a baseline, while the admin rollup computed a RATIO OVER THE
   * COHORT from a second copy of the same SQL — so a board could be told it was
   * beating a baseline that the sales deck computed differently. Now the facts
   * CTE, the session value and the cohort aggregate each exist once.
   *
   * The baseline deliberately EXCLUDES this session: a cohort of one compared
   * against itself always reads "average", which is the least useful thing a
   * scorecard can say.
   */
  router.get('/:id/outcome-metrics', async (c) => {
    const access = await requireSession(c, 'viewer');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    // Read-through cached: the panel re-polls on every open, the cohort query
    // touches up to 500 sessions' worth of subqueries, and a board's own
    // numbers do not meaningfully move inside a minute.
    const payload = await getOrSetCached(
      c.env as Env,
      `creation:outcome-metrics:${access.session.tenantId}:${access.session.id}`,
      async () => {
        // The workspace's most recently active boards, PLUS this one.
        //
        // Bounded because a scorecard is a comparison, not a census — and the
        // bound is stated on the payload as `sampleSize` rather than left for a
        // reader to assume. The union is not cosmetic: without it, a board that
        // had fallen outside the most-recent 500 was absent from its own
        // scorecard and the panel answered 404 — the sessions least likely to be
        // in that window being precisely the older ones somebody has come back
        // to ask "what did this ever produce?".
        const cohort = sql`
          SELECT id, tenant_id, created_at FROM (
            SELECT id, tenant_id, created_at, last_activity_at FROM creation_sessions
            WHERE tenant_id = ${access.session.tenantId} AND status <> 'deleted'
            ORDER BY last_activity_at DESC
            LIMIT ${OUTCOME_BASELINE_COHORT}
          ) recent
          UNION
          SELECT id, tenant_id, created_at FROM creation_sessions WHERE id = ${access.session.id}
        `;
        const facts = sql`WITH facts AS (${outcomeFactsSql(cohort)})`;
        const [own, baseline] = await Promise.all([
          db.execute(sql`${facts} SELECT * FROM facts WHERE id = ${access.session.id}`),
          db.execute(sql`${facts} SELECT ${outcomeAggregateSql()} FROM facts WHERE id <> ${access.session.id}`),
        ]);
        const fact = own.rows[0] as OutcomeFact | undefined;
        if (!fact) return null;
        const baselineRow = baseline.rows[0] as Record<string, unknown> | undefined;
        return {
          sessionId: access.session.id,
          scope: 'tenant' as const,
          definitionVersion: OUTCOME_DEFINITION_VERSION,
          northStarKey: NORTH_STAR_METRIC_KEY,
          families: OUTCOME_METRIC_FAMILIES.map((key) => ({ key, label: OUTCOME_FAMILY_LABELS[key] })),
          sampleSize: Number(baselineRow?.sessionCount ?? 0),
          metrics: toOutcomeMetricValues(
            (metric) => metric.session(fact),
            (metric) => aggregateMetricValue(baselineRow, metric.key),
          ),
        };
      },
      { kvTtlSeconds: 60 },
    );
    if (!payload) return c.json({ error: 'Session metrics unavailable' }, 404);
    return c.json(payload);
  });

  /**
   * The OTHER half of Idea→delivery: what the thing this session built then did
   * for somebody.
   *
   * The sibling route above measures the PROCESS — how fast and how reliably this
   * board produced an artifact — and on its own that is a productivity report. It
   * can say a board shipped faster than its peers and cannot say whether anybody
   * outside the building ever touched what it shipped.
   *
   * This reads the ATTRIBUTED facts the rollups already stamp (`canvas.shipped`
   * against `session:<id>`, `growth.leads` / `growth.conversions` against the
   * `site:<id>` of the sites whose `site_collections.origin_session_id` traces
   * back here). It computes nothing: a second computation of the same numbers
   * beside the first is how the panel and the rollup come to disagree.
   *
   * Cached on the same short TTL as its sibling for the same reason — the panel
   * re-polls on every open and these numbers do not move inside a minute.
   */
  router.get('/:id/attributed-outcomes', async (c) => {
    const access = await requireSession(c, 'viewer');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const payload = await getOrSetCached(
      c.env as Env,
      `creation:attributed-outcomes:${access.session.tenantId}:${access.session.id}`,
      () => buildAttributedOutcomes(db, { tenantId: access.session.tenantId, sessionId: access.session.id }),
      { kvTtlSeconds: 60 },
    );
    return c.json(payload);
  });

  router.get('/:id/events', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const after = Math.max(0, Math.floor(Number(c.req.query('after') ?? 0) || 0));
    const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? 200)));
    const events = await db.select().from(creationSessionEvents).where(and(
      eq(creationSessionEvents.sessionId, access.session.id),
      sql`${creationSessionEvents.revision} > ${after}`,
    )).orderBy(asc(creationSessionEvents.revision)).limit(limit);
    return c.json({ events, revision: access.session.canvasRevision, hasMore: events.length === limit });
  });

  /**
   * The board's live channel. Two things ride it: the server's `{type:"changed"}`
   * fan-out (revision + timeline invalidation), and — because this connection is
   * admitted as a PEER — every collaborator's pointer, at pointer speed.
   *
   * The identity handed to `relayToRoom` is the one `requireSession` just proved,
   * never one the client claimed, so a socket cannot move another member's cursor.
   * See `SessionRoomDO` for the frame contract and why only `canvas.presence`
   * crosses the relay.
   */
  router.get('/:id/ws', async (c) => {
    const access = await requireSession(c, 'viewer');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    return relayToRoom(
      c,
      c.env?.SESSION_ROOM,
      creationSessionRoomName(access.session.tenantId, access.session.id),
      { ref: c.get('userId') as string, kind: 'human' },
    );
  });

  router.get('/:id/preview', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const graph = await visibleGraph(access.session.id, access.session.tenantId, access.session.segmentId, c.get('userId') as string);
    return c.json({
      sessionId: access.session.id,
      title: access.session.title,
      revision: access.session.canvasRevision,
      preview: buildPreview(graph.objects),
      lastActivityAt: access.session.lastActivityAt,
    });
  });

  router.get('/:id/export', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const [graph, timeline] = await Promise.all([
      visibleGraph(access.session.id, access.session.tenantId, access.session.segmentId, c.get('userId') as string),
      db.select({ clientMessageId: creationSessionTimeline.clientMessageId, messageRole: creationSessionTimeline.messageRole, body: creationSessionTimeline.body, metadata: creationSessionTimeline.metadata, createdAt: creationSessionTimeline.createdAt })
        .from(creationSessionTimeline).where(eq(creationSessionTimeline.sessionId, access.session.id)).orderBy(asc(creationSessionTimeline.id)),
    ]);
    return c.json({
      format: 'builderforce.creation-session.v1',
      exportedAt: new Date().toISOString(),
      session: { id: access.session.id, title: access.session.title, description: access.session.description, revision: access.session.canvasRevision },
      objects: graph.objects.map(({ searchText: _searchText, lockedBy: _lockedBy, lockExpiresAt: _lockExpiresAt, ...object }) => object),
      connections: graph.connections,
      timeline,
    });
  });

  router.get('/:id/activity', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50)));
    const [events, comments] = await Promise.all([
      db.select({
        id: creationSessionEvents.id,
        type: creationSessionEvents.eventType,
        objectId: creationSessionEvents.objectId,
        payload: creationSessionEvents.payload,
        revision: creationSessionEvents.revision,
        actorRef: creationSessionEvents.actorRef,
        actorName: users.displayName,
        createdAt: creationSessionEvents.createdAt,
      }).from(creationSessionEvents)
        .leftJoin(users, eq(users.id, creationSessionEvents.actorRef))
        .where(eq(creationSessionEvents.sessionId, access.session.id))
        .orderBy(desc(creationSessionEvents.createdAt)).limit(limit),
      db.select({
        id: creationSessionComments.id,
        objectId: creationSessionComments.objectId,
        body: creationSessionComments.body,
        actorRef: creationSessionComments.createdBy,
        actorName: users.displayName,
        resolvedAt: creationSessionComments.resolvedAt,
        createdAt: creationSessionComments.createdAt,
      }).from(creationSessionComments)
        .leftJoin(users, eq(users.id, creationSessionComments.createdBy))
        .where(eq(creationSessionComments.sessionId, access.session.id))
        .orderBy(desc(creationSessionComments.createdAt)).limit(limit),
    ]);
    const activity = [
      ...events.map((event) => ({ ...event, kind: 'event' as const })),
      ...comments.map((comment) => ({ ...comment, kind: 'comment' as const, type: comment.resolvedAt ? 'comment.resolved' : 'comment.created' })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
    return c.json({ activity });
  });

  router.get('/:id/timeline', async (c) => {
    const access = await requireSession(c, 'viewer');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const after = Math.max(0, Math.floor(Number(c.req.query('after') || 0)));
    const limit = Math.min(500, Math.max(1, Math.floor(Number(c.req.query('limit') || 200))));
    const messages = await db.select().from(creationSessionTimeline).where(and(
      eq(creationSessionTimeline.sessionId, access.session.id),
      after ? gt(creationSessionTimeline.id, after) : undefined,
    )).orderBy(asc(creationSessionTimeline.id)).limit(limit);
    const humanIds = [...new Set(messages.filter((message) => message.messageRole === 'user' && message.createdBy).map((message) => message.createdBy!))];
    const humanRows = humanIds.length ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, humanIds)) : [];
    const humanNames = new Map(humanRows.map((human) => [human.id, human.name || 'Collaborator']));
    const attributed = messages.map((message) => {
      const raw = message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata) ? message.metadata as Record<string, unknown> : {};
      return message.messageRole === 'user' && message.createdBy && !raw.authoredBy
        ? { ...message, metadata: { ...raw, authoredBy: { kind: 'human', ref: message.createdBy, name: humanNames.get(message.createdBy) || 'Collaborator' } } }
        : message;
    });
    return c.json({ messages: attributed, lastId: messages.at(-1)?.id ?? after, hasMore: messages.length === limit });
  });

  router.post('/:id/timeline', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or prompting is not allowed' }, 404);
    const input = await c.req.json<TimelineBody>().catch(() => ({} as TimelineBody));
    const clientMessageId = typeof input.clientMessageId === 'string' ? input.clientMessageId.trim().slice(0, 128) : '';
    const role = input.role === 'assistant' || input.role === 'system' ? input.role : 'user';
    const body = typeof input.body === 'string' ? input.body.trim().slice(0, 50_000) : '';
    if (!clientMessageId || !body) return c.json({ error: 'clientMessageId and body are required' }, 400);
    const rawMeta = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata as Record<string, unknown> : {};
    const userId = c.get('userId') as string;
    const [human] = role === 'user' ? await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId)).limit(1) : [];
    const metadata = {
      ...(typeof rawMeta.scope === 'string' ? { scope: rawMeta.scope.slice(0, 32) } : {}),
      ...(Array.isArray(rawMeta.objectIds) ? { objectIds: rawMeta.objectIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)).slice(0, 100) } : {}),
      ...(typeof rawMeta.model === 'string' ? { model: rawMeta.model.slice(0, 120) } : {}),
      ...(typeof rawMeta.error === 'boolean' ? { error: rawMeta.error } : {}),
      ...(role === 'user' ? { authoredBy: { kind: 'human', ref: userId, name: human?.name || 'Collaborator' } } : rawMeta.authoredBy && typeof rawMeta.authoredBy === 'object' && !Array.isArray(rawMeta.authoredBy) ? {
        authoredBy: {
          kind: (rawMeta.authoredBy as Record<string, unknown>).kind === 'agent' ? 'agent' : 'brain',
          ref: String((rawMeta.authoredBy as Record<string, unknown>).ref || '').slice(0, 128),
          name: String((rawMeta.authoredBy as Record<string, unknown>).name || '').slice(0, 160),
        },
      } : {}),
    };
    const [inserted] = await db.insert(creationSessionTimeline).values({
      sessionId: access.session.id, clientMessageId, messageRole: role, body, metadata, createdBy: userId,
    }).onConflictDoNothing({ target: [creationSessionTimeline.sessionId, creationSessionTimeline.clientMessageId] }).returning();
    const message = inserted ?? (await db.select().from(creationSessionTimeline).where(and(
      eq(creationSessionTimeline.sessionId, access.session.id), eq(creationSessionTimeline.clientMessageId, clientMessageId),
    )).limit(1))[0];
    await db.update(creationSessions).set({ lastActivityAt: new Date(), updatedAt: new Date(), updatedBy: c.get('userId') as string }).where(and(
      eq(creationSessions.id, access.session.id), eq(creationSessions.tenantId, access.session.tenantId),
    ));
    c.executionCtx.waitUntil(broadcastRoom(
      c.env?.SESSION_ROOM,
      creationSessionRoomName(access.session.tenantId, access.session.id),
      JSON.stringify({ type: 'timeline.changed', lastId: message?.id ?? 0 }),
    ));
    return c.json(message, inserted ? 201 : 200);
  });

  router.get('/:id/comments', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const objectId = c.req.query('objectId');
    if (objectId && !UUID_RE.test(objectId)) return c.json({ error: 'Invalid object id' }, 400);
    const where = objectId
      ? and(eq(creationSessionComments.sessionId, access.session.id), eq(creationSessionComments.objectId, objectId))
      : eq(creationSessionComments.sessionId, access.session.id);
    const comments = await db.select({
      id: creationSessionComments.id,
      objectId: creationSessionComments.objectId,
      parentCommentId: creationSessionComments.parentCommentId,
      body: creationSessionComments.body,
      mentions: creationSessionComments.mentions,
      anchor: creationSessionComments.anchor,
      createdBy: creationSessionComments.createdBy,
      authorName: users.displayName,
      resolvedAt: creationSessionComments.resolvedAt,
      resolvedBy: creationSessionComments.resolvedBy,
      createdAt: creationSessionComments.createdAt,
      updatedAt: creationSessionComments.updatedAt,
    }).from(creationSessionComments)
      .leftJoin(users, eq(users.id, creationSessionComments.createdBy))
      .where(where).orderBy(desc(creationSessionComments.createdAt)).limit(200);
    return c.json({ comments });
  });

  router.get('/:id/objects/:objectId/resume-shares', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const objectId = c.req.param('objectId');
    if (!UUID_RE.test(objectId)) return c.json({ error: 'Invalid object id' }, 400);
    const registered = await findObject(db, access.session.tenantId, 'canvas_resume', objectId);
    if (!registered) return c.json({ shares: [] });
    return c.json({ shares: await getObjectShares(db, c.env, access.session.tenantId, registered.id) });
  });

  router.post('/:id/objects/:objectId/resume-shares', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const objectId = c.req.param('objectId');
    if (!UUID_RE.test(objectId)) return c.json({ error: 'Invalid object id' }, 400);
    const registered = await ensureResumeObject(db, c.env, access, objectId);
    if (!registered) return c.json({ error: 'Only a public resume can be shared' }, 409);
    const body = await c.req.json<ResumeShareBody>().catch(() => ({} as ResumeShareBody));
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) return c.json({ error: 'Expiry must be in the future' }, 400);
    const maxUses = body.maxUses == null ? null : Math.floor(body.maxUses);
    if (maxUses != null && (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > 1_000_000)) return c.json({ error: 'maxUses must be between 1 and 1,000,000' }, 400);
    const share = await createShareLink(db, c.env, {
      tenantId: access.session.tenantId,
      objectId: registered.id,
      scope: 'view',
      expiresAt,
      maxUses,
      createdBy: c.get('userId') as string,
    });
    return c.json({ ...share, viewPath: `/resume/${share.token}`, embedPath: `/embed/resume/${share.token}` }, 201);
  });

  router.delete('/:id/objects/:objectId/resume-shares/:shareId', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const objectId = c.req.param('objectId');
    const registered = UUID_RE.test(objectId) ? await findObject(db, access.session.tenantId, 'canvas_resume', objectId) : null;
    if (!registered) return c.json({ error: 'Resume share not found' }, 404);
    const shareId = c.req.param('shareId');
    const ownsShare = (await getObjectShares(db, c.env, access.session.tenantId, registered.id)).some((share) => share.id === shareId);
    if (!ownsShare) return c.json({ error: 'Resume share not found' }, 404);
    await revokeShareLink(db, c.env, access.session.tenantId, registered.id, shareId);
    return c.body(null, 204);
  });

  /**
   * The seller's half of the prospect share: mint, list, revoke, and read what the buyer
   * did with it. Editor-gated, because minting a link is giving away access.
   *
   * These live beside the résumé shares deliberately — same primitive, same session, same
   * revocation path — rather than in a `/api/prospect-shares` tree of their own, which
   * would be a second place a canvas session's outbound links are managed from.
   */
  router.get('/:id/prospect-shares', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    return c.json({ shares: await listProspectShares(db, c.env, access.session.tenantId, access.session.id) });
  });

  router.post('/:id/prospect-shares', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const body = await c.req.json<ProspectShareBody>().catch(() => ({} as ProspectShareBody));

    const objectId = typeof body.objectId === 'string' && body.objectId.trim() ? body.objectId.trim() : null;
    if (objectId && !UUID_RE.test(objectId)) return c.json({ error: 'Invalid object id' }, 400);

    let objectKind: string | null = null;
    let objectTitle: string | null = null;
    let objectConfidentiality: ConfidentialityLevel | null = null;
    if (objectId) {
      const [row] = await db.select({ kind: creationSessionObjects.kind, content: creationSessionObjects.content })
        .from(creationSessionObjects)
        .where(and(eq(creationSessionObjects.id, objectId), eq(creationSessionObjects.sessionId, access.session.id)))
        .limit(1);
      if (!row) return c.json({ error: 'Object not found on this session' }, 404);
      objectKind = row.kind;
      objectTitle = cleanTitle((row.content as Record<string, unknown> | null)?.title, row.kind);
      // Read from the STORED row, never from the request body: a client that could name
      // its own confidentiality could name `public` for a grievance, which is not a
      // boundary at all. The row is the only copy the author actually wrote.
      const declared = (row.content as Record<string, unknown> | null)?.confidentiality;
      objectConfidentiality = isConfidentialityLevel(declared) ? declared : null;
    }

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) {
      return c.json({ error: 'Expiry must be in the future' }, 400);
    }

    const settings: ProspectShareSettings = {
      sellerName: String(body.sellerName ?? '').trim().slice(0, 120),
      sellerCompany: String(body.sellerCompany ?? '').trim().slice(0, 160),
      accentColor: String(body.accentColor ?? '').trim().slice(0, 32),
      allowControlRequest: body.allowControlRequest === true,
      message: String(body.message ?? '').trim().slice(0, 600),
    };

    const minted = await mintProspectShare(db, c.env, {
      tenantId: access.session.tenantId,
      sessionId: access.session.id,
      sessionTitle: access.session.title,
      objectId,
      objectKind,
      objectTitle,
      objectConfidentiality,
      label: String(body.label ?? objectTitle ?? access.session.title ?? '').slice(0, 160),
      settings,
      expiresAt,
      createdBy: c.get('userId') as string,
    });
    if ('error' in minted) return c.json({ error: minted.error }, 409);
    return c.json({ ...minted, shareableKinds: [...SHAREABLE_CANVAS_KINDS] }, 201);
  });

  router.delete('/:id/prospect-shares/:shareId', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const shares = await listProspectShares(db, c.env, access.session.tenantId, access.session.id);
    const shareId = c.req.param('shareId');
    // Ownership is proved by the share appearing in THIS session's list, not by a
    // tenant match alone — otherwise a share id from another board in the same workspace
    // would be revocable from here, which is a control nobody asked for.
    if (!shares.some((share) => share.id === shareId)) return c.json({ error: 'Share not found' }, 404);
    await revokeProspectShare(db, c.env, access.session.tenantId, shareId);
    return c.body(null, 204);
  });

  /**
   * What the prospect DID. The board-level share when no `objectId` is given, one card's
   * when there is — the same split minting draws, so a seller reads engagement wherever
   * they shared from.
   */
  router.get('/:id/prospect-engagement', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const objectId = c.req.query('objectId');
    if (objectId) {
      if (!UUID_RE.test(objectId)) return c.json({ error: 'Invalid object id' }, 400);
      const card = await findCardShare(db, c.env, access.session.tenantId, objectId);
      if (!card) return c.json({ error: 'This card has never been shared' }, 404);
      const engagement = await readProspectEngagement(db, access.session.tenantId, card.objectId);
      // No URL is returned. The raw token exists exactly once, at creation
      // (`createShareLink`), and only its hash is stored — so a read path CANNOT
      // reconstruct the link, and pretending otherwise would be the one place this
      // feature quietly re-introduced a recoverable credential.
      return c.json({ engagement, shared: card.share != null });
    }
    const registered = await findObject(db, access.session.tenantId, 'creation_session', access.session.id);
    if (!registered) return c.json({ error: 'This board has never been shared' }, 404);
    return c.json({ engagement: await readProspectEngagement(db, access.session.tenantId, registered.id) });
  });

  router.post('/:id/comments', async (c) => {
    const access = await requireSession(c, 'commenter');
    if (!access) return c.json({ error: 'Session not found or comments are not allowed' }, 404);
    const body = await c.req.json<CommentBody>().catch(() => ({} as CommentBody));
    const content = typeof body.body === 'string' ? body.body.trim() : '';
    if (!content || content.length > 5_000) return c.json({ error: 'Comment must be between 1 and 5,000 characters' }, 400);
    const objectId = body.objectId || null;
    if (objectId) {
      if (!UUID_RE.test(objectId)) return c.json({ error: 'Invalid object id' }, 400);
      const [object] = await db.select({ id: creationSessionObjects.id }).from(creationSessionObjects)
        .where(and(eq(creationSessionObjects.id, objectId), eq(creationSessionObjects.sessionId, access.session.id))).limit(1);
      if (!object) return c.json({ error: 'Object not found in this session' }, 404);
    }
    const parentCommentId = body.parentCommentId || null;
    let parentCreator: string | null = null;
    if (parentCommentId) {
      if (!UUID_RE.test(parentCommentId)) return c.json({ error: 'Invalid parent comment id' }, 400);
      const [parent] = await db.select({ id: creationSessionComments.id, createdBy: creationSessionComments.createdBy }).from(creationSessionComments)
        .where(and(eq(creationSessionComments.id, parentCommentId), eq(creationSessionComments.sessionId, access.session.id))).limit(1);
      if (!parent) return c.json({ error: 'Parent comment not found' }, 404);
      parentCreator = parent.createdBy;
    }
    const requestedMentions = [...new Set((body.mentions ?? []).filter((id) => typeof id === 'string' && id.length <= 36))].slice(0, 20);
    const memberMentions = requestedMentions.length
      ? await db.select({ userId: creationSessionMembers.userId }).from(creationSessionMembers)
        .where(and(eq(creationSessionMembers.sessionId, access.session.id), inArray(creationSessionMembers.userId, requestedMentions)))
      : [];
    const userId = c.get('userId') as string;
    const anchor = cleanCommentAnchor(body.anchor);
    if (body.anchor !== undefined && !anchor) return c.json({ error: 'Invalid comment anchor' }, 400);
    const [created] = await db.insert(creationSessionComments).values({
      sessionId: access.session.id, objectId, parentCommentId, body: content,
      mentions: memberMentions.map((member) => member.userId), anchor, createdBy: userId,
    }).returning();
    await db.update(creationSessions).set({ lastActivityAt: new Date(), updatedAt: new Date(), updatedBy: userId })
      .where(and(eq(creationSessions.id, access.session.id), eq(creationSessions.tenantId, access.session.tenantId)));
    await notifyAttention(c, access.session.id, {
      kind: parentCommentId ? 'creation.comment.reply' : 'creation.comment',
      title: parentCommentId ? `New reply in ${access.session.title}` : `New comment in ${access.session.title}`,
      body: content.slice(0, 500),
      directUserIds: [...memberMentions.map((member) => member.userId), ...(parentCreator ? [parentCreator] : [])],
      allWatchers: true,
    });
    return c.json(created, 201);
  });

  router.patch('/:id/comments/:commentId', async (c) => {
    const access = await requireSession(c, 'commenter');
    if (!access) return c.json({ error: 'Session not found or comments are not allowed' }, 404);
    const commentId = c.req.param('commentId');
    if (!UUID_RE.test(commentId)) return c.json({ error: 'Invalid comment id' }, 400);
    const body: { resolved?: boolean } = await c.req.json<{ resolved?: boolean }>().catch(() => ({}));
    if (typeof body.resolved !== 'boolean') return c.json({ error: 'resolved is required' }, 400);
    const userId = c.get('userId') as string;
    const [updated] = await db.update(creationSessionComments).set({
      resolvedAt: body.resolved ? new Date() : null,
      resolvedBy: body.resolved ? userId : null,
      updatedAt: new Date(),
    }).where(and(eq(creationSessionComments.id, commentId), eq(creationSessionComments.sessionId, access.session.id))).returning();
    if (!updated) return c.json({ error: 'Comment not found' }, 404);
    return c.json(updated);
  });

  router.patch('/:id', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or not editable' }, 404);
    const body = await c.req.json<PatchSessionBody>().catch(() => ({} as PatchSessionBody));
    const patch: Partial<typeof creationSessions.$inferInsert> = { updatedBy: c.get('userId') as string, updatedAt: new Date(), lastActivityAt: new Date() };
    if (body.title !== undefined) patch.title = cleanTitle(body.title);
    if (body.description !== undefined) patch.description = body.description == null ? null : String(body.description).slice(0, 2_000);
    if (body.folder !== undefined) patch.folder = body.folder == null || !String(body.folder).trim() ? null : String(body.folder).trim().slice(0, 120);
    if (body.status === 'active' || body.status === 'archived') {
      patch.status = body.status;
      patch.archivedAt = body.status === 'archived' ? new Date() : null;
    }
    if (body.preview !== undefined) patch.preview = body.preview;
    // Conversation (`chat`) vs execution (`work`) — migration 0409, same vocabulary as
    // `brain_chats.mode`. An unrecognised value leaves the column untouched rather than
    // silently demoting a session that is mid-execution.
    const nextMode = normalizeChatMode(body.mode);
    if (nextMode) patch.mode = nextMode;
    const [updated] = await db.update(creationSessions).set(patch).where(and(
      eq(creationSessions.id, access.session.id),
      eq(creationSessions.tenantId, access.session.tenantId),
    )).returning();
    if (body.status && body.status !== access.session.status) await notifyAttention(c, access.session.id, {
      kind: body.status === 'archived' ? 'creation.session.archived' : 'creation.session.restored',
      title: `${access.session.title} was ${body.status === 'archived' ? 'archived' : 'restored'}`,
      allWatchers: true,
    });
    c.executionCtx.waitUntil(bumpPublicCanvasVersion(c.env, access.session.tenantId));
    return c.json(updated);
  });

  router.delete('/:id', async (c) => {
    const access = await requireSession(c, 'owner');
    if (!access) return c.json({ error: 'Session not found or not removable' }, 404);
    const now = new Date();
    const nextRevision = access.session.canvasRevision + 1;
    const [deleted] = await db.update(creationSessions).set({
      status: 'deleted', archivedAt: now, updatedAt: now, lastActivityAt: now, updatedBy: c.get('userId') as string,
      canvasRevision: nextRevision,
    }).where(and(
      eq(creationSessions.id, access.session.id),
      eq(creationSessions.tenantId, access.session.tenantId),
    )).returning({ id: creationSessions.id, status: creationSessions.status });
    await db.insert(creationSessionEvents).values({
      sessionId: access.session.id,
      revision: nextRevision,
      actorType: 'user',
      actorRef: c.get('userId') as string,
      eventType: 'session.deleted',
      payload: { retention: true },
    });
    c.executionCtx.waitUntil(bumpPublicCanvasVersion(c.env, access.session.tenantId));
    return c.json({ session: deleted, recoverable: true });
  });

  async function ownerCount(sessionId: string): Promise<number> {
    return countRows('creation_session_members', sql`session_id = ${sessionId} AND role = 'owner'`);
  }

  router.patch('/:id/members/:userId', async (c) => {
    const access = await requireSession(c, 'owner');
    if (!access) return c.json({ error: 'Session not found or membership is not editable' }, 404);
    const targetUserId = c.req.param('userId');
    const body = await c.req.json<MemberBody>().catch(() => ({} as MemberBody));
    const role = cleanRole(body.role);
    if (!role) return c.json({ error: 'A valid role is required' }, 400);
    const [target] = await db.select({ role: creationSessionMembers.role }).from(creationSessionMembers).where(and(
      eq(creationSessionMembers.sessionId, access.session.id),
      eq(creationSessionMembers.userId, targetUserId),
    )).limit(1);
    if (!target) return c.json({ error: 'Session member not found' }, 404);
    if (target.role === 'owner' && role !== 'owner' && await ownerCount(access.session.id) <= 1) {
      return c.json({ error: 'Transfer ownership before demoting the final owner', code: 'FINAL_SESSION_OWNER' }, 409);
    }
    await db.update(creationSessionMembers).set({ role }).where(and(
      eq(creationSessionMembers.sessionId, access.session.id),
      eq(creationSessionMembers.userId, targetUserId),
    ));
    await notifyAttention(c, access.session.id, {
      kind: 'creation.session.role_changed', title: `Your role changed in ${access.session.title}`,
      body: `Access role: ${role}`, directUserIds: [targetUserId],
    });
    return c.json({ userId: targetUserId, role });
  });

  router.delete('/:id/members/:userId', async (c) => {
    const access = await requireSession(c, 'owner');
    if (!access) return c.json({ error: 'Session not found or membership is not editable' }, 404);
    const targetUserId = c.req.param('userId');
    const [target] = await db.select({ role: creationSessionMembers.role }).from(creationSessionMembers).where(and(
      eq(creationSessionMembers.sessionId, access.session.id),
      eq(creationSessionMembers.userId, targetUserId),
    )).limit(1);
    if (!target) return c.json({ error: 'Session member not found' }, 404);
    if (target.role === 'owner' && await ownerCount(access.session.id) <= 1) {
      return c.json({ error: 'Transfer ownership before removing the final owner', code: 'FINAL_SESSION_OWNER' }, 409);
    }
    await db.delete(creationSessionMembers).where(and(
      eq(creationSessionMembers.sessionId, access.session.id),
      eq(creationSessionMembers.userId, targetUserId),
    ));
    return c.body(null, 204);
  });

  router.post('/:id/pin', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const body = await c.req.json<PinBody>().catch(() => ({} as PinBody));
    if (typeof body.pinned !== 'boolean') return c.json({ error: 'pinned is required' }, 400);
    await db.update(creationSessionMembers).set({ pinned: body.pinned }).where(and(
      eq(creationSessionMembers.sessionId, access.session.id), eq(creationSessionMembers.userId, c.get('userId') as string),
    ));
    return c.json({ pinned: body.pinned });
  });

  router.patch('/:id/watch', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const body = await c.req.json<WatchBody>().catch(() => ({} as WatchBody));
    if (body.state !== 'all' && body.state !== 'mentions' && body.state !== 'muted') {
      return c.json({ error: 'state must be all, mentions, or muted' }, 400);
    }
    await db.update(creationSessionMembers).set({ watchState: body.state }).where(and(
      eq(creationSessionMembers.sessionId, access.session.id),
      eq(creationSessionMembers.userId, c.get('userId') as string),
    ));
    return c.json({ state: body.state });
  });

  router.post('/:id/objects/:objectId/lock', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or not editable' }, 404);
    const objectId = c.req.param('objectId');
    if (!UUID_RE.test(objectId)) return c.json({ error: 'Invalid object id' }, 400);
    const body = await c.req.json<LockBody>().catch(() => ({} as LockBody));
    const action = body.action ?? 'acquire';
    const userId = c.get('userId') as string;
    const now = new Date();
    const [object] = await db.select({ id: creationSessionObjects.id, lockedBy: creationSessionObjects.lockedBy, lockExpiresAt: creationSessionObjects.lockExpiresAt })
      .from(creationSessionObjects).where(and(eq(creationSessionObjects.id, objectId), eq(creationSessionObjects.sessionId, access.session.id))).limit(1);
    if (!object) return c.json({ error: 'Object not found' }, 404);
    if (action === 'release') {
      if (object.lockedBy && object.lockedBy !== userId && object.lockExpiresAt && object.lockExpiresAt > now) return c.json({ error: 'Object is locked by another collaborator', code: 'OBJECT_LOCKED' }, 409);
      await db.update(creationSessionObjects).set({ lockedBy: null, lockExpiresAt: null }).where(eq(creationSessionObjects.id, objectId));
      return c.json({ objectId, lockedBy: null, lockExpiresAt: null });
    }
    if (action !== 'acquire' && action !== 'renew') return c.json({ error: 'Unsupported lock action' }, 400);
    if (object.lockedBy && object.lockedBy !== userId && object.lockExpiresAt && object.lockExpiresAt > now) {
      return c.json({ error: 'Object is locked by another collaborator', code: 'OBJECT_LOCKED', lockedBy: object.lockedBy, lockExpiresAt: object.lockExpiresAt }, 409);
    }
    const leaseSeconds = Math.min(120, Math.max(15, Math.floor(body.leaseSeconds ?? 60)));
    const lockExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000);
    await db.update(creationSessionObjects).set({ lockedBy: userId, lockExpiresAt }).where(and(eq(creationSessionObjects.id, objectId), eq(creationSessionObjects.sessionId, access.session.id)));
    return c.json({ objectId, lockedBy: userId, lockExpiresAt });
  });

  router.post('/:id/objects/:objectId/request-access', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const objectId = c.req.param('objectId');
    if (!UUID_RE.test(objectId)) return c.json({ error: 'Invalid object id' }, 400);
    const [object, owners] = await Promise.all([
      db.select({ id: creationSessionObjects.id, kind: creationSessionObjects.kind }).from(creationSessionObjects).where(and(eq(creationSessionObjects.id, objectId), eq(creationSessionObjects.sessionId, access.session.id))).limit(1).then((rows) => rows[0]),
      db.select({ userId: creationSessionMembers.userId }).from(creationSessionMembers).where(and(eq(creationSessionMembers.sessionId, access.session.id), eq(creationSessionMembers.role, 'owner'))),
    ]);
    if (!object) return c.json({ error: 'Object not found' }, 404);
    await notifyAttention(c, access.session.id, {
      kind: 'creation.resource.access_requested',
      title: `Access requested in ${access.session.title}`,
      body: `A collaborator requested access to a ${object.kind} object.`,
      directUserIds: owners.map((owner) => owner.userId),
    });
    return c.json({ requested: true }, 202);
  });

  router.post('/:id/duplicate', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const quota = await sessionQuota(c, tenantId);
    if (!quota.allowed) return c.json(creationSessionQuotaError(quota), 402);
    const [objects, connections, timeline] = await Promise.all([
      db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, access.session.id)),
      db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, access.session.id)),
      db.select().from(creationSessionTimeline).where(eq(creationSessionTimeline.sessionId, access.session.id)).orderBy(asc(creationSessionTimeline.id)),
    ]);
    const sessionId = crypto.randomUUID();
    const idMap = new Map(objects.map((object) => [object.id, crypto.randomUUID()]));
    const copiedObjects = objects.map((object) => ({
      ...object, id: idMap.get(object.id)!, sessionId, createdBy: userId, updatedBy: userId, createdAt: undefined, updatedAt: undefined,
    }));
    const copiedConnections = connections.map((edge) => ({
      ...edge, id: crypto.randomUUID(), sessionId, sourceObjectId: idMap.get(edge.sourceObjectId)!, targetObjectId: idMap.get(edge.targetObjectId)!, createdBy: userId, createdAt: undefined,
    }));
    const graph = {
      objects: copiedObjects.map(({ id, kind, resourceType, resourceId, resourceRevision, canvasData, content }) => ({ id, kind, resourceType, resourceId, resourceRevision, canvasData, content })),
      connections: copiedConnections.map(({ id, sourceObjectId, targetObjectId, kind, label, metadata }) => ({ id, sourceObjectId, targetObjectId, kind, label, metadata })),
    };
    const statements: unknown[] = newCreationSessionStatements(db, {
      sessionId, tenantId, segmentId,
      title: cleanTitle(`Copy of ${access.session.title}`),
      objects: graph.objects, connections: graph.connections,
      authorUserId: userId,
      eventType: 'session.duplicated',
      eventPayload: { sourceSessionId: access.session.id },
      viewport: access.session.viewport,
      columns: { description: access.session.description, folder: access.session.folder },
    }).map((write) => write.statement);
    if (timeline.length) statements.push(db.insert(creationSessionTimeline).values(timeline.map((message) => ({ sessionId, clientMessageId: message.clientMessageId, messageRole: message.messageRole, body: message.body, metadata: message.metadata, createdBy: userId }))));
    const projectLinks = await db.select({ projectId: creationSessionProjectLinks.projectId }).from(creationSessionProjectLinks).where(and(eq(creationSessionProjectLinks.sessionId, access.session.id), copyableLinkFilter));
    if (projectLinks.length) statements.push(db.insert(creationSessionProjectLinks).values(projectLinks.map(({ projectId }) => ({ sessionId, projectId, addedBy: userId }))));
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    return c.json({ session: { id: sessionId, title: cleanTitle(`Copy of ${access.session.title}`), revision: 1 } }, 201);
  });

  router.post('/:id/merge', async (c) => {
    const targetAccess = await requireSession(c, 'editor');
    if (!targetAccess) return c.json({ error: 'Target session not found or not editable' }, 404);
    const body = await c.req.json<MergeBody>().catch(() => ({} as MergeBody));
    const sourceId = body.sourceSessionId ?? '';
    if (!UUID_RE.test(sourceId) || sourceId === targetAccess.session.id) return c.json({ error: 'A different source session is required' }, 400);
    const userId = c.get('userId') as string;
    const sourceAccess = await membership(sourceId, targetAccess.session.tenantId, userId);
    if (!sourceAccess || ROLE_RANK[sourceAccess.role as SessionRole] < ROLE_RANK.editor || sourceAccess.session.segmentId !== targetAccess.session.segmentId) {
      return c.json({ error: 'Source session not found or not editable' }, 404);
    }
    if (sourceAccess.session.status !== 'active') return c.json({ error: 'Only an active session can be merged' }, 409);

    const [targetObjects, targetConnections, sourceObjects, sourceConnections, sourceTimeline, targetProjectLinks, sourceProjectLinks] = await Promise.all([
      db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, targetAccess.session.id)),
      db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, targetAccess.session.id)),
      db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, sourceId)),
      db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, sourceId)),
      db.select().from(creationSessionTimeline).where(eq(creationSessionTimeline.sessionId, sourceId)).orderBy(asc(creationSessionTimeline.id)),
      db.select({ projectId: creationSessionProjectLinks.projectId }).from(creationSessionProjectLinks).where(and(eq(creationSessionProjectLinks.sessionId, targetAccess.session.id), copyableLinkFilter)),
      db.select({ projectId: creationSessionProjectLinks.projectId }).from(creationSessionProjectLinks).where(and(eq(creationSessionProjectLinks.sessionId, sourceId), copyableLinkFilter)),
    ]);
    const targetResources = new Set(targetObjects.flatMap((object) => object.resourceType && object.resourceId ? [`${object.resourceType}:${object.resourceId}`] : []));
    const acceptedSourceObjects = sourceObjects.filter((object) => !object.resourceType || !object.resourceId || !targetResources.has(`${object.resourceType}:${object.resourceId}`));
    const idMap = new Map(acceptedSourceObjects.map((object) => [object.id, crypto.randomUUID()]));
    const copiedObjects = acceptedSourceObjects.map((object) => {
      const canvasData = object.canvasData && typeof object.canvasData === 'object' && !Array.isArray(object.canvasData)
        ? { ...(object.canvasData as Record<string, unknown>), x: Number((object.canvasData as Record<string, unknown>).x ?? 0) + 120, y: Number((object.canvasData as Record<string, unknown>).y ?? 0) + 120 }
        : { x: 120, y: 120 };
      return { id: idMap.get(object.id)!, sessionId: targetAccess.session.id, kind: object.kind, resourceType: object.resourceType, resourceId: object.resourceId, resourceRevision: object.resourceRevision, canvasData, content: object.content, searchText: object.searchText, createdBy: userId, updatedBy: userId };
    });
    const copiedConnections = sourceConnections.flatMap((edge) => {
      const sourceObjectId = idMap.get(edge.sourceObjectId);
      const targetObjectId = idMap.get(edge.targetObjectId);
      return sourceObjectId && targetObjectId ? [{ id: crypto.randomUUID(), sessionId: targetAccess.session.id, sourceObjectId, targetObjectId, kind: edge.kind, label: edge.label, metadata: edge.metadata, createdBy: userId }] : [];
    });
    const graphObjects = [...targetObjects, ...copiedObjects].map(({ id, kind, resourceType, resourceId, resourceRevision, canvasData, content }) => ({ id, kind, resourceType, resourceId, resourceRevision, canvasData, content }));
    const graphConnections = [...targetConnections, ...copiedConnections].map(({ id, sourceObjectId, targetObjectId, kind, label, metadata }) => ({ id, sourceObjectId, targetObjectId, kind, label, metadata }));
    const graphError = validCreationGraph(graphObjects, graphConnections);
    if (graphError) return c.json({ error: graphError }, 400);

    const revision = targetAccess.session.canvasRevision + 1;
    const now = new Date();
    const graph = { objects: graphObjects, connections: graphConnections };
    const targetProjects = new Set(targetProjectLinks.map(({ projectId }) => projectId));
    const newProjectLinks = sourceProjectLinks.filter(({ projectId }) => !targetProjects.has(projectId));
    const statements: unknown[] = [
      db.update(creationSessions).set({ canvasRevision: revision, preview: buildPreview(graphObjects), updatedBy: userId, updatedAt: now, lastActivityAt: now }).where(scopedToTenant(creationSessions, targetAccess.session.tenantId, eq(creationSessions.id, targetAccess.session.id))),
      db.update(creationSessions).set({ status: 'archived', archivedAt: now, updatedBy: userId, updatedAt: now, lastActivityAt: now }).where(scopedToTenant(creationSessions, targetAccess.session.tenantId, eq(creationSessions.id, sourceId))),
      db.insert(creationSessionEvents).values({ sessionId: targetAccess.session.id, revision, actorType: 'user', actorRef: userId, eventType: 'session.merged', payload: { sourceSessionId: sourceId, importedObjects: copiedObjects.length } }),
      db.insert(creationSessionSnapshots).values({ sessionId: targetAccess.session.id, revision, graph, viewport: targetAccess.session.viewport, createdBy: userId }),
    ];
    if (copiedObjects.length) statements.push(db.insert(creationSessionObjects).values(copiedObjects));
    if (copiedConnections.length) statements.push(db.insert(creationSessionConnections).values(copiedConnections));
    if (sourceTimeline.length) statements.push(db.insert(creationSessionTimeline).values(sourceTimeline.map((message) => ({ sessionId: targetAccess.session.id, clientMessageId: `merge:${crypto.randomUUID()}`, messageRole: message.messageRole, body: message.body, metadata: message.metadata, createdBy: message.createdBy }))));
    if (newProjectLinks.length) statements.push(db.insert(creationSessionProjectLinks).values(newProjectLinks.map(({ projectId }) => ({ sessionId: targetAccess.session.id, projectId, addedBy: userId }))));
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    await pruneHistory(targetAccess.session.id, targetAccess.session.tenantId);
    return c.json({ session: { id: targetAccess.session.id, title: targetAccess.session.title, revision }, mergedSessionId: sourceId });
  });

  router.post('/:id/branches', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or not editable' }, 404);
    const quota = await sessionQuota(c, access.session.tenantId);
    if (!quota.allowed) return c.json(creationSessionQuotaError(quota), 402);
    const body = await c.req.json<BranchBody>().catch(() => ({} as BranchBody));
    const userId = c.get('userId') as string;
    const [objects, connections, projectLinks, timeline] = await Promise.all([
      db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, access.session.id)),
      db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, access.session.id)),
      db.select({ projectId: creationSessionProjectLinks.projectId }).from(creationSessionProjectLinks).where(and(eq(creationSessionProjectLinks.sessionId, access.session.id), copyableLinkFilter)),
      db.select().from(creationSessionTimeline).where(eq(creationSessionTimeline.sessionId, access.session.id)).orderBy(asc(creationSessionTimeline.id)),
    ]);
    const sessionId = crypto.randomUUID();
    const idMap = new Map(objects.map((object) => [object.id, crypto.randomUUID()]));
    const copiedObjects = objects.map((object) => {
      const content = object.content && typeof object.content === 'object' && !Array.isArray(object.content)
        ? { ...(object.content as Record<string, unknown>), _branchOriginId: object.id }
        : { _branchOriginId: object.id };
      return { ...object, id: idMap.get(object.id)!, sessionId, content, searchText: creationObjectSearchText(content), lockedBy: null, lockExpiresAt: null, createdBy: userId, updatedBy: userId, createdAt: undefined, updatedAt: undefined };
    });
    const copiedConnections = connections.map((edge) => ({ ...edge, id: crypto.randomUUID(), sessionId, sourceObjectId: idMap.get(edge.sourceObjectId)!, targetObjectId: idMap.get(edge.targetObjectId)!, createdBy: userId, createdAt: undefined }));
    const graph = {
      objects: copiedObjects.map(({ id, kind, resourceType, resourceId, resourceRevision, canvasData, content }) => ({ id, kind, resourceType, resourceId, resourceRevision, canvasData, content })),
      connections: copiedConnections.map(({ id, sourceObjectId, targetObjectId, kind, label, metadata }) => ({ id, sourceObjectId, targetObjectId, kind, label, metadata })),
    };
    const title = cleanTitle(body.title, `${access.session.title} branch`);
    const statements: unknown[] = newCreationSessionStatements(db, {
      sessionId, tenantId: access.session.tenantId, segmentId: access.session.segmentId, title,
      objects: graph.objects, connections: graph.connections,
      authorUserId: userId,
      eventType: 'session.branched',
      eventPayload: { parentSessionId: access.session.id, baseRevision: access.session.canvasRevision },
      viewport: access.session.viewport,
      columns: {
        description: access.session.description, folder: access.session.folder,
        branchParentSessionId: access.session.id, branchBaseRevision: access.session.canvasRevision,
      },
    }).map((write) => write.statement);
    if (timeline.length) statements.push(db.insert(creationSessionTimeline).values(timeline.map((message) => ({ sessionId, clientMessageId: message.clientMessageId, messageRole: message.messageRole, body: message.body, metadata: message.metadata, createdBy: userId }))));
    if (projectLinks.length) statements.push(db.insert(creationSessionProjectLinks).values(projectLinks.map(({ projectId }) => ({ sessionId, projectId, addedBy: userId }))));
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    return c.json({ session: { id: sessionId, title, revision: 1, parentSessionId: access.session.id, baseRevision: access.session.canvasRevision } }, 201);
  });

  router.post('/:id/templates/:templateId/apply', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or not editable' }, 404);
    const templateId = c.req.param('templateId');
    if (!UUID_RE.test(templateId)) return c.json({ error: 'Invalid template id' }, 400);
    const userId = c.get('userId') as string;
    const [template] = await db.select().from(creationSessionTemplates).where(and(
      eq(creationSessionTemplates.id, templateId), eq(creationSessionTemplates.tenantId, access.session.tenantId),
      eq(creationSessionTemplates.segmentId, access.session.segmentId!),
      or(eq(creationSessionTemplates.visibility, 'tenant'), eq(creationSessionTemplates.createdBy, userId)),
    )).limit(1);
    if (!template) return c.json({ error: 'Template not found' }, 404);
    const templateGraph = parseTemplateGraph(template.graph);
    if (!templateGraph) return c.json({ error: 'Template graph is invalid' }, 422);
    const match = Number(c.req.header('If-Match'));
    if (!Number.isInteger(match) || match !== access.session.canvasRevision) return c.json({ error: 'Session changed', code: 'REVISION_CONFLICT', revision: access.session.canvasRevision }, 409);
    const [storedObjects, storedConnections] = await Promise.all([
      db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, access.session.id)),
      db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, access.session.id)),
    ]);
    const existingResources = new Set(storedObjects.filter((object) => object.resourceType && object.resourceId).map((object) => `${object.resourceType}:${object.resourceId}`));
    if (templateGraph.objects.some((object) => object.resourceType && object.resourceId && existingResources.has(`${object.resourceType}:${object.resourceId}`))) {
      return c.json({ error: 'This template contains a resource already on the Canvas', code: 'DUPLICATE_RESOURCE' }, 409);
    }
    const idMap = new Map(templateGraph.objects.map((object) => [object.id, crypto.randomUUID()]));
    const offset = 80 + storedObjects.length * 12;
    const addedObjects = templateGraph.objects.map((object) => ({
      ...object, id: idMap.get(object.id)!,
      canvasData: object.canvasData && typeof object.canvasData === 'object'
        ? { ...(object.canvasData as Record<string, unknown>), x: Number((object.canvasData as Record<string, unknown>).x ?? 0) + offset, y: Number((object.canvasData as Record<string, unknown>).y ?? 0) + offset }
        : { x: offset, y: offset },
    }));
    const addedConnections = templateGraph.connections.map((edge) => ({ ...edge, id: crypto.randomUUID(), sourceObjectId: idMap.get(edge.sourceObjectId)!, targetObjectId: idMap.get(edge.targetObjectId)! }));
    const objects: GraphObjectInput[] = [...storedObjects.map((object) => ({ id: object.id, kind: object.kind, resourceType: object.resourceType, resourceId: object.resourceId, resourceRevision: object.resourceRevision, canvasData: object.canvasData, content: object.content })), ...addedObjects];
    const connections: GraphConnectionInput[] = [...storedConnections.map((edge) => ({ id: edge.id, sourceObjectId: edge.sourceObjectId, targetObjectId: edge.targetObjectId, kind: edge.kind, label: edge.label, metadata: edge.metadata })), ...addedConnections];
    const resourceError = await validateResourceAccess(objects, access.session.tenantId, access.session.segmentId, userId);
    if (resourceError) return c.json({ error: resourceError, code: 'RESOURCE_ACCESS_DENIED' }, 403);
    const nextRevision = access.session.canvasRevision + 1;
    const statements: unknown[] = [];
    if (addedObjects.length) statements.push(db.insert(creationSessionObjects).values(addedObjects.map((object) => ({
      id: object.id, sessionId: access.session.id, kind: object.kind, resourceType: object.resourceType ?? null, resourceId: object.resourceId ?? null,
      resourceRevision: object.resourceRevision ?? null, canvasData: object.canvasData ?? {}, content: object.content ?? null,
      searchText: creationObjectSearchText(object.content), createdBy: userId, updatedBy: userId,
    }))));
    if (addedConnections.length) statements.push(db.insert(creationSessionConnections).values(addedConnections.map((edge) => ({
      id: edge.id, sessionId: access.session.id, sourceObjectId: edge.sourceObjectId, targetObjectId: edge.targetObjectId,
      kind: edge.kind ?? 'reference', label: edge.label ?? null, metadata: edge.metadata ?? null, createdBy: userId,
    }))));
    statements.push(
      db.update(creationSessions).set({ canvasRevision: nextRevision, preview: buildPreview(objects), updatedBy: userId, updatedAt: new Date(), lastActivityAt: new Date() }).where(and(
        eq(creationSessions.id, access.session.id),
        eq(creationSessions.tenantId, access.session.tenantId),
        access.session.segmentId == null
          ? isNull(creationSessions.segmentId)
          : eq(creationSessions.segmentId, access.session.segmentId),
      )),
      db.insert(creationSessionEvents).values({ sessionId: access.session.id, revision: nextRevision, actorType: 'user', actorRef: userId, eventType: 'template.applied', payload: { templateId, objectCount: addedObjects.length } }),
      db.insert(creationSessionSnapshots).values({ sessionId: access.session.id, revision: nextRevision, graph: { objects, connections }, viewport: access.session.viewport, createdBy: userId }),
    );
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    await pruneHistory(access.session.id, access.session.tenantId);
    return c.json({ revision: nextRevision, objectIds: [...idMap.values()] }, 201);
  });

  router.put('/:id/graph', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or not editable' }, 404);
    const body = await c.req.json<SaveGraphBody>().catch(() => ({} as SaveGraphBody));
    const objects = Array.isArray(body.objects) ? body.objects : [];
    const connections = Array.isArray(body.connections) ? body.connections : [];
    const error = validCreationGraph(objects, connections);
    if (error) return c.json({ error }, 400);
    const resourceError = await validateResourceAccess(objects, access.session.tenantId, access.session.segmentId, c.get('userId') as string);
    if (resourceError) return c.json({ error: resourceError, code: 'RESOURCE_ACCESS_DENIED' }, 403);
    const locked = await canonicalLockConflict(access.session.id, c.get('userId') as string, objects);
    if (locked) return c.json({ error: 'An object is being edited by another collaborator', code: 'OBJECT_LOCKED', objectId: locked.id, lockedBy: locked.lockedBy, lockExpiresAt: locked.lockExpiresAt }, 409);
    if (body.expectedRevision != null && body.expectedRevision !== access.session.canvasRevision) {
      return c.json({ error: 'Session changed', code: 'REVISION_CONFLICT', revision: access.session.canvasRevision }, 409);
    }
    const userId = c.get('userId') as string;
    const nextRevision = access.session.canvasRevision + 1;
    // D1 batch is atomic: replacement graph + revision/event commit together, so
    // a failed insert cannot leave the session empty after the deletes. The seven
    // statements themselves are `creationGraphWriter`'s — see that module for why
    // the ORDER is the part that must not be re-typed per caller.
    const statements = creationGraphStatements(db, {
      sessionId: access.session.id,
      tenantId: access.session.tenantId,
      objects, connections,
      revision: nextRevision,
      actorType: 'user', actorRef: userId, authorUserId: userId,
      eventType: 'canvas.saved',
      eventPayload: { objectCount: objects.length, connectionCount: connections.length },
      idempotencyKey: c.req.header('Idempotency-Key')?.slice(0, 128) || null,
      viewport: body.viewport ?? access.session.viewport,
      snapshotOnConflictDoNothing: true,
    });
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    await pruneHistory(access.session.id, access.session.tenantId);
    c.executionCtx.waitUntil(Promise.all([
      broadcastRoom(
        c.env?.SESSION_ROOM,
        creationSessionRoomName(access.session.tenantId, access.session.id),
        JSON.stringify({ type: 'canvas.changed', revision: nextRevision }),
      ),
      // The public `/api/v1/boards` listing is cached under a tenant version token
      // (see `publicCanvasVersionKey`). An in-product save changes what that listing
      // says, so the in-product save is one of its writers — otherwise an integrator
      // polling the API sees a board's activity go stale the moment a person edits it.
      bumpPublicCanvasVersion(c.env, access.session.tenantId),
    ]));
    return c.json({ revision: nextRevision, savedAt: new Date().toISOString() });
  });

  router.post('/:id/commands', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or not editable' }, 404);
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim().slice(0, 128) || null;
    if (!idempotencyKey) return c.json({ error: 'Idempotency-Key is required' }, 400);
    const [prior] = await db.select({ payload: creationSessionEvents.payload }).from(creationSessionEvents).where(and(
      eq(creationSessionEvents.sessionId, access.session.id), eq(creationSessionEvents.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (prior) return c.json((prior.payload as { result?: unknown })?.result ?? { replayed: true });

    const match = Number(c.req.header('If-Match'));
    if (!Number.isInteger(match) || match !== access.session.canvasRevision) {
      return c.json({ error: 'Session changed', code: 'REVISION_CONFLICT', revision: access.session.canvasRevision }, 409);
    }
    const body = await c.req.json<CommandsBody>().catch(() => ({} as CommandsBody));
    const commands = Array.isArray(body.commands) ? body.commands.slice(0, 500) : [];
    if (!commands.length) return c.json({ error: 'At least one command is required' }, 400);

    const [storedObjects, storedConnections] = await Promise.all([
      db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, access.session.id)),
      db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, access.session.id)),
    ]);
    const activeForeignLocks = new Map(storedObjects.filter((object) => object.lockedBy && object.lockedBy !== c.get('userId') && object.lockExpiresAt && object.lockExpiresAt > new Date()).map((object) => [object.id, object]));
    let objects: GraphObjectInput[] = storedObjects.map((object) => ({
      id: object.id, kind: object.kind, resourceType: object.resourceType, resourceId: object.resourceId,
      resourceRevision: object.resourceRevision, canvasData: object.canvasData, content: object.content,
    }));
    let connections: GraphConnectionInput[] = storedConnections.map((edge) => ({
      id: edge.id, sourceObjectId: edge.sourceObjectId, targetObjectId: edge.targetObjectId,
      kind: edge.kind, label: edge.label, metadata: edge.metadata,
    }));
    let personalViewport: unknown = null;
    const accepted: Array<{ index: number; type: string; id?: string; clientId?: string }> = [];
    const rejected: Array<{ index: number; error: string }> = [];
    const clientIds = new Map<string, string>();
    const reject = (index: number, error: string) => {
      rejected.push({ index, error });
      if (body.atomic !== false) throw new Error(error);
    };
    try {
      commands.forEach((command, index) => {
        const type = typeof command.type === 'string' ? command.type : '';
        if (type === 'graph.replace') {
          if (!Array.isArray(command.objects) || !Array.isArray(command.connections)) { reject(index, 'graph.replace requires objects and connections'); return; }
          objects = command.objects as GraphObjectInput[];
          connections = command.connections as GraphConnectionInput[];
          personalViewport = command.viewport ?? null;
          accepted.push({ index, type }); return;
        }
        if (type === 'object.add') {
          const kind = typeof command.kind === 'string' ? command.kind.slice(0, 48) : '';
          if (!isCreationObjectKind(kind)) { reject(index, `Unsupported object kind: ${kind || 'missing'}`); return; }
          const id = typeof command.id === 'string' && UUID_RE.test(command.id) ? command.id : crypto.randomUUID();
          const clientId = typeof command.clientId === 'string' ? command.clientId.slice(0, 128) : undefined;
          if (objects.some((object) => object.id === id)) { reject(index, 'Object id already exists'); return; }
          const resourceRef = command.resourceRef && typeof command.resourceRef === 'object' ? command.resourceRef as { type?: unknown; id?: unknown } : null;
          objects.push({
            id, kind,
            resourceType: typeof resourceRef?.type === 'string' ? resourceRef.type : null,
            resourceId: typeof resourceRef?.id === 'string' || typeof resourceRef?.id === 'number' ? String(resourceRef.id) : null,
            canvasData: command.geometry && typeof command.geometry === 'object' ? command.geometry : {},
            content: command.content && typeof command.content === 'object' ? command.content : { kind, title: String(command.title || kind) },
          });
          if (clientId) clientIds.set(clientId, id);
          accepted.push({ index, type, id, clientId }); return;
        }
        if (type === 'object.update' || type === 'object.move') {
          const id = String(command.objectId || '');
          const object = objects.find((candidate) => candidate.id === id);
          if (!object) { reject(index, 'Object not found'); return; }
          if (type === 'object.update' && activeForeignLocks.has(id)) { reject(index, 'Object is being edited by another collaborator'); return; }
          if (type === 'object.move' && command.geometry && typeof command.geometry === 'object') object.canvasData = { ...(object.canvasData as object), ...(command.geometry as object) };
          if (type === 'object.update' && command.content && typeof command.content === 'object') object.content = { ...(object.content as object), ...(command.content as object) };
          accepted.push({ index, type, id }); return;
        }
        if (type === 'object.delete') {
          const id = String(command.objectId || '');
          if (!objects.some((object) => object.id === id)) { reject(index, 'Object not found'); return; }
          if (activeForeignLocks.has(id)) { reject(index, 'Object is being edited by another collaborator'); return; }
          objects = objects.filter((object) => object.id !== id);
          connections = connections.filter((edge) => edge.sourceObjectId !== id && edge.targetObjectId !== id);
          accepted.push({ index, type, id }); return;
        }
        if (type === 'connection.add') {
          const resolveId = (value: unknown) => clientIds.get(String(value)) ?? String(value || '');
          const sourceObjectId = resolveId(command.sourceId);
          const targetObjectId = resolveId(command.targetId);
          if (!objects.some((object) => object.id === sourceObjectId) || !objects.some((object) => object.id === targetObjectId)) { reject(index, 'Connection endpoint not found'); return; }
          const id = typeof command.id === 'string' && UUID_RE.test(command.id) ? command.id : crypto.randomUUID();
          const kind = command.kind == null ? 'reference' : command.kind;
          if (!isCreationConnectionKind(kind)) { reject(index, `Unsupported connection kind: ${String(kind)}`); return; }
          connections.push({ id, sourceObjectId, targetObjectId, kind, label: typeof command.label === 'string' ? command.label : null });
          accepted.push({ index, type, id }); return;
        }
        if (type === 'connection.delete') {
          const id = String(command.connectionId || '');
          if (!connections.some((edge) => edge.id === id)) { reject(index, 'Connection not found'); return; }
          connections = connections.filter((edge) => edge.id !== id);
          accepted.push({ index, type, id }); return;
        }
        if (type === 'viewport.set') {
          personalViewport = command.viewport;
          accepted.push({ index, type }); return;
        }
        reject(index, `Unsupported command: ${type || 'missing type'}`);
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Command batch rejected', rejected }, 400);
    }
    const graphError = validCreationGraph(objects, connections);
    if (graphError) return c.json({ error: graphError, rejected }, 400);
    const resourceError = await validateResourceAccess(objects, access.session.tenantId, access.session.segmentId, c.get('userId') as string);
    if (resourceError) return c.json({ error: resourceError, code: 'RESOURCE_ACCESS_DENIED', rejected }, 403);
    const nextRevision = access.session.canvasRevision + 1;
    const userId = c.get('userId') as string;
    const result = { accepted, rejected, serverIds: Object.fromEntries(clientIds), revision: nextRevision, savedAt: new Date().toISOString() };
    // The board viewport is left exactly as it was: `personalViewport` is a PERSONAL
    // camera and belongs on the member row appended below, not on the session. It is
    // still what the snapshot records, because a snapshot is a reading of what this
    // writer saw.
    const statements = creationGraphStatements(db, {
      sessionId: access.session.id,
      tenantId: access.session.tenantId,
      objects, connections,
      revision: nextRevision,
      actorType: 'user', actorRef: userId, authorUserId: userId,
      eventType: 'canvas.commands_applied',
      eventPayload: { commands, result },
      idempotencyKey,
      viewport: access.session.viewport,
      snapshotViewport: personalViewport ?? access.session.viewport,
      // NOT swallowed here: a snapshot conflict means a concurrent writer took this
      // revision, and the caller has to be told — it is translated into the 409 below.
      snapshotOnConflictDoNothing: false,
    });
    if (personalViewport) statements.push(db.update(creationSessionMembers).set({ viewport: personalViewport }).where(and(eq(creationSessionMembers.sessionId, access.session.id), eq(creationSessionMembers.userId, userId))));
    try {
      await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    } catch (error) {
      // The If-Match check above is necessarily a read before this transaction.
      // A concurrent writer can commit the same next revision (or idempotency key)
      // between those operations. The event uniqueness constraints serialize the
      // writes; translate the expected losing transaction instead of leaking a 500.
      if (!isCreationEventWriteConflict(error)) throw error;
      const [[replayed], [current]] = await Promise.all([
        db.select({ payload: creationSessionEvents.payload }).from(creationSessionEvents).where(and(
          eq(creationSessionEvents.sessionId, access.session.id), eq(creationSessionEvents.idempotencyKey, idempotencyKey),
        )).limit(1),
        db.select({ revision: creationSessions.canvasRevision }).from(creationSessions).where(and(
          eq(creationSessions.id, access.session.id), eq(creationSessions.tenantId, access.session.tenantId),
        )).limit(1),
      ]);
      if (replayed) return c.json((replayed.payload as { result?: unknown })?.result ?? { replayed: true });
      return c.json({
        error: 'Session changed', code: 'REVISION_CONFLICT', revision: current?.revision ?? access.session.canvasRevision,
      }, 409);
    }
    await pruneHistory(access.session.id, access.session.tenantId);
    c.executionCtx.waitUntil(Promise.all([
      broadcastRoom(
        c.env?.SESSION_ROOM,
        creationSessionRoomName(access.session.tenantId, access.session.id),
        JSON.stringify({ type: 'canvas.changed', revision: nextRevision }),
      ),
      // The public `/api/v1/boards` listing is cached under a tenant version token
      // (see `publicCanvasVersionKey`). An in-product save changes what that listing
      // says, so the in-product save is one of its writers — otherwise an integrator
      // polling the API sees a board's activity go stale the moment a person edits it.
      bumpPublicCanvasVersion(c.env, access.session.tenantId),
    ]));
    return c.json(result);
  });

  router.post('/invitations/:token/accept', async (c) => {
    const rawToken = c.req.param('token');
    if (!/^[0-9a-f]{64}$/i.test(rawToken)) return c.json({ error: 'Invalid invitation token' }, 400);
    const tokenHash = await sha256Hex(rawToken);
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    // `findByTokenHash` returns only rows that are still pending — accepted,
    // revoked and expired are filtered by the service's one `isPending()` — so the
    // route no longer re-derives "still usable" from four nullable columns.
    const invitation = await findByTokenHash(db, tokenHash);
    if (!invitation || invitation.tenantId !== tenantId || invitation.kind !== 'session') {
      return c.json({ error: 'Invitation is invalid, expired, or already used' }, 410);
    }
    if (!user?.email || !invitation.email || user.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) {
      return c.json({ error: 'Sign in with the email address that received this invitation' }, 403);
    }
    const role = cleanRole(invitation.role);
    if (!role) return c.json({ error: 'Invitation role is invalid' }, 409);
    // The invitation points at the session through the object registry, so the
    // session id is the registry entry's `refId` rather than a column here.
    const target = invitation.objectId ? await getObject(db, c.env, tenantId, invitation.objectId) : null;
    if (!target) return c.json({ error: 'Invitation is invalid, expired, or already used' }, 410);
    const sessionId = target.refId;
    await db.batch([
      db.insert(creationSessionMembers).values({ sessionId, userId, role, invitedBy: invitation.invitedBy })
        .onConflictDoUpdate({ target: [creationSessionMembers.sessionId, creationSessionMembers.userId], set: { role } }),
      acceptInvitationStatement(db, { tenantId, id: invitation.id, inviteeRef: userId }),
    ]);
    // The batch bypasses `acceptInvitation`, so its cache drop happens here.
    await invalidateInvitations(c.env, tenantId);
    return c.json({ sessionId, role });
  });

  router.get('/:id/invitations', async (c) => {
    const access = await requireSession(c, 'owner');
    if (!access) return c.json({ error: 'Session not found or invitations are not visible' }, 404);
    const object = await findSessionObject(db, access.session);
    const invitations = object ? await listForObject(db, access.session.tenantId, object.id) : [];
    return c.json({ invitations });
  });

  router.delete('/:id/invitations/:invitationId', async (c) => {
    const access = await requireSession(c, 'owner');
    if (!access) return c.json({ error: 'Session not found or invitations are not editable' }, 404);
    const invitationId = c.req.param('invitationId');
    if (!UUID_RE.test(invitationId)) return c.json({ error: 'Invalid invitation id' }, 400);
    // Scoped to this session's object before revoking, so an owner of one session
    // cannot revoke an invitation belonging to another.
    const object = await findSessionObject(db, access.session);
    const onThisSession = object
      && (await listForObject(db, access.session.tenantId, object.id)).some((row) => row.id === invitationId);
    const revoked = onThisSession
      && (await revokeInvitation(db, c.env, { tenantId: access.session.tenantId, id: invitationId }));
    if (!revoked) return c.json({ error: 'Pending invitation not found' }, 404);
    return c.body(null, 204);
  });

  router.get('/:id/history', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const snapshots = await db.select({ revision: creationSessionSnapshots.revision, label: creationSessionSnapshots.label, createdBy: creationSessionSnapshots.createdBy, createdAt: creationSessionSnapshots.createdAt })
      .from(creationSessionSnapshots).where(eq(creationSessionSnapshots.sessionId, access.session.id))
      .orderBy(desc(creationSessionSnapshots.revision)).limit(100);
    return c.json({ snapshots });
  });

  router.post('/:id/checkpoints', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or not editable' }, 404);
    const body = await c.req.json<CheckpointBody>().catch(() => ({} as CheckpointBody));
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) : '';
    if (!label) return c.json({ error: 'Checkpoint name is required' }, 400);
    const [objects, connections] = await Promise.all([
      db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, access.session.id)),
      db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, access.session.id)),
    ]);
    const graph = { objects, connections };
    await db.insert(creationSessionSnapshots).values({ sessionId: access.session.id, revision: access.session.canvasRevision, graph, viewport: access.session.viewport, label, createdBy: c.get('userId') as string })
      .onConflictDoUpdate({ target: [creationSessionSnapshots.sessionId, creationSessionSnapshots.revision], set: { label, graph, viewport: access.session.viewport } });
    return c.json({ revision: access.session.canvasRevision, label }, 201);
  });

  router.get('/:id/history/:revision', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const revision = Number(c.req.param('revision'));
    if (!Number.isInteger(revision) || revision < 0) return c.json({ error: 'Invalid revision' }, 400);
    const [snapshot] = await db.select().from(creationSessionSnapshots).where(and(eq(creationSessionSnapshots.sessionId, access.session.id), eq(creationSessionSnapshots.revision, revision))).limit(1);
    if (!snapshot) return c.json({ error: 'Snapshot not found' }, 404);
    return c.json(snapshot);
  });

  router.post('/:id/invite', async (c) => {
    const access = await requireSession(c, 'owner');
    if (!access) return c.json({ error: 'Session not found or not shareable' }, 404);
    const body = await c.req.json<InviteBody>().catch(() => ({} as InviteBody));
    const role = cleanRole(body.role ?? 'editor');
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if ((!body.userId && !email) || !role) return c.json({ error: 'A userId or email and role are required' }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'A valid email is required' }, 400);
    const tenantId = c.get('tenantId') as number;
    const [target] = await db.select({ id: users.id, email: users.email }).from(users)
      .innerJoin(tenantMembers, and(
        eq(tenantMembers.userId, users.id),
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.isActive, true),
      ))
      .where(or(body.userId ? eq(users.id, body.userId) : sql`false`, email ? eq(users.email, email) : sql`false`)).limit(1);
    if (!target) {
      if (!email) return c.json({ error: 'User not found' }, 404);
      const rawToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
      const tokenHash = await sha256Hex(rawToken);
      const expiresInHours = Math.min(24 * 30, Math.max(1, Math.floor(Number(body.expiresInHours) || 24 * 7)));
      const expiresAt = new Date(Date.now() + expiresInHours * 3_600_000);
      const object = await ensureSessionObject(db, c.env, access.session);
      const invitation = await inviteToObject(db, c.env, {
        tenantId,
        kind: 'session',
        objectId: object.id,
        email,
        role,
        tokenHash,
        expiresAt,
        invitedBy: c.get('userId') as string,
      });
      // A canvas invite to a stranger implies a workspace invite. No pre-check:
      // `invite()` is idempotent on (tenant, kind, email) for a pending row, which
      // is the select-then-insert race the service exists to remove.
      await inviteToObject(db, c.env, {
        tenantId,
        kind: 'tenant',
        email,
        role: 'developer',
        invitedBy: c.get('userId') as string,
      });
      const acceptPath = `/create/invitations/${rawToken}`;
      const [inviter] = await db.select({ name: users.displayName, email: users.email }).from(users)
        .where(eq(users.id, c.get('userId') as string)).limit(1);
      let emailSent = false;
      if (c.env.RESEND_API_KEY) {
        try {
          await sendTransactionalEmail(c.env, db, email, ({ locale }) => sendCreationSessionInviteEmail(c.env, email, {
            sessionTitle: access.session.title,
            inviterName: inviter?.name || inviter?.email || 'A teammate',
            sessionUrl: `${resolveAppBaseUrl(c.env)}${acceptPath}`,
            role,
            expiresAt: expiresAt.toISOString(),
            locale,
          }));
          emailSent = true;
        } catch (error) {
          reportCaughtError(error, {
            source: 'application/creation/creationSessionRouteService.ts',
            operation: 'sendCreationSessionInvite',
            level: 'warning',
            context: { logMessage: '[creation-session] invite email failed (invitation remains saved)', details: error },
          });
        }
      }
      return c.json({
        invitationId: invitation.id,
        email,
        role,
        expiresAt: expiresAt.toISOString(),
        acceptPath,
        emailSent,
      }, 201);
    }
    const [existingMember] = await db.select({ userId: creationSessionMembers.userId }).from(creationSessionMembers).where(and(eq(creationSessionMembers.sessionId, access.session.id), eq(creationSessionMembers.userId, target.id))).limit(1);
    if (!existingMember) {
      const limits = await creationLimits(tenantId);
      const memberCount = await countRows('creation_session_members', sql`session_id = ${access.session.id}`);
      if (limits.maxCreationSessionCollaborators !== -1 && memberCount >= limits.maxCreationSessionCollaborators) {
        return c.json({ error: 'Collaborator limit reached', code: 'CREATION_COLLABORATOR_QUOTA', usage: memberCount, limit: limits.maxCreationSessionCollaborators }, 403);
      }
    }
    await db.insert(creationSessionMembers).values({ sessionId: access.session.id, userId: target.id, role, invitedBy: c.get('userId') as string })
      .onConflictDoUpdate({ target: [creationSessionMembers.sessionId, creationSessionMembers.userId], set: { role } });
    // Keep a durable invitation record even when the person already has an
    // account. acceptedAt distinguishes this immediate membership grant from a
    // pending cold-email invite while preserving the campaign/audit evidence.
    const auditObject = await ensureSessionObject(db, c.env, access.session);
    const auditRow = await inviteToObject(db, c.env, {
      tenantId,
      kind: 'session',
      objectId: auditObject.id,
      email: target.email,
      role,
      expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
      invitedBy: c.get('userId') as string,
    });
    // Immediately accepted, which is what distinguishes this record from a pending
    // cold-email invite. If the person already had a pending invite to this
    // session, `invite()` returned that row and this resolves it rather than
    // leaving it open beside a membership they now hold.
    await acceptInvitation(db, c.env, { id: auditRow.id, tenantId, inviteeRef: target.id });
    await notifyAttention(c, access.session.id, {
      kind: existingMember ? 'creation.session.role_changed' : 'creation.session.invitation', title: existingMember ? `Your role changed in ${access.session.title}` : `You were invited to ${access.session.title}`,
      body: `Access role: ${role}`, directUserIds: [target.id],
    });
    const [inviter] = await db.select({ name: users.displayName, email: users.email }).from(users)
      .where(eq(users.id, c.get('userId') as string)).limit(1);
    let emailSent = false;
    if (c.env.RESEND_API_KEY) {
      try {
        await sendTransactionalEmail(c.env, db, target.email, ({ locale }) => sendCreationSessionInviteEmail(c.env, target.email, {
          sessionTitle: access.session.title,
          inviterName: inviter?.name || inviter?.email || 'A teammate',
          sessionUrl: `${resolveAppBaseUrl(c.env)}/create/${access.session.id}`,
          role,
          expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
          locale,
        }));
        emailSent = true;
      } catch (error) {
        reportCaughtError(error, {
          source: 'application/creation/creationSessionRouteService.ts',
          operation: 'sendCreationSessionInvite',
          level: 'warning',
          context: { logMessage: '[creation-session] member invite email failed (membership remains saved)', details: error },
        });
      }
    }
    return c.json({ userId: target.id, role, emailSent }, 201);
  });

  router.post('/:id/presence', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const body: { revision?: number; viewport?: unknown; cursor?: unknown; selection?: unknown; typing?: boolean; followingUserId?: string | null } = await c.req.json<{ revision?: number; viewport?: unknown; cursor?: unknown; selection?: unknown; typing?: boolean; followingUserId?: string | null }>().catch(() => ({}));
    const now = new Date();
    const revision = Number.isFinite(body.revision) ? Math.max(0, Math.floor(body.revision!)) : access.session.canvasRevision;
    const viewport = body.viewport && typeof body.viewport === 'object' ? body.viewport : access.session.viewport;
    const cursor = body.cursor && typeof body.cursor === 'object' ? body.cursor : null;
    const selection = Array.isArray(body.selection) ? body.selection.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)).slice(0, 100) : [];
    const followingUserId = typeof body.followingUserId === 'string' && body.followingUserId !== c.get('userId') ? body.followingUserId : null;
    if (followingUserId) {
      const [followTarget] = await db.select({ userId: creationSessionMembers.userId }).from(creationSessionMembers).where(and(eq(creationSessionMembers.sessionId, access.session.id), eq(creationSessionMembers.userId, followingUserId))).limit(1);
      if (!followTarget) return c.json({ error: 'Follow target is not a session member' }, 400);
    }
    await db.update(creationSessionMembers).set({ lastSeenAt: now, lastSeenRevision: revision, viewport, cursor, selection, typing: body.typing === true, followingUserId }).where(and(
      eq(creationSessionMembers.sessionId, access.session.id),
      eq(creationSessionMembers.userId, c.get('userId') as string),
    ));
    const activeSince = new Date(now.getTime() - 60_000);
    const members = await db.select({
      userId: creationSessionMembers.userId,
      role: creationSessionMembers.role,
      displayName: users.displayName,
      lastSeenRevision: creationSessionMembers.lastSeenRevision,
      lastSeenAt: creationSessionMembers.lastSeenAt,
      viewport: creationSessionMembers.viewport,
      cursor: creationSessionMembers.cursor,
      selection: creationSessionMembers.selection,
      typing: creationSessionMembers.typing,
      followingUserId: creationSessionMembers.followingUserId,
    }).from(creationSessionMembers)
      .leftJoin(users, eq(users.id, creationSessionMembers.userId))
      .where(and(eq(creationSessionMembers.sessionId, access.session.id), gte(creationSessionMembers.lastSeenAt, activeSince)));
    const limits = await creationLimits(access.session.tenantId);
    const activeEditors = members.filter((member) => ROLE_RANK[member.role as SessionRole] >= ROLE_RANK.editor).length;
    if (limits.maxCreationRealtimeEditors !== -1 && activeEditors > limits.maxCreationRealtimeEditors && ROLE_RANK[access.role as SessionRole] >= ROLE_RANK.editor) {
      await db.update(creationSessionMembers).set({ typing: false, followingUserId: null }).where(and(eq(creationSessionMembers.sessionId, access.session.id), eq(creationSessionMembers.userId, c.get('userId') as string)));
      return c.json({ error: 'Realtime editor limit reached; reopen as view-only', code: 'CREATION_REALTIME_QUOTA', usage: activeEditors, limit: limits.maxCreationRealtimeEditors }, 429);
    }
    return c.json({ revision: access.session.canvasRevision, currentUserId: c.get('userId'), members });
  });

  /**
   * Return one permission-checked, batched project graph. The client owns spatial
   * placement; stable resource references make applying the same lens idempotent.
   */
  router.post('/:id/projects/:projectId/expand', async (c) => {
    const access = await requireSession(c, 'viewer');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isInteger(projectId) || projectId <= 0) return c.json({ error: 'Invalid project id' }, 400);
    const body = await c.req.json<ExpandProjectBody>().catch(() => ({} as ExpandProjectBody));
    const lens = ['delivery', 'metrics', 'customer-feedback'].includes(String(body.lens))
      ? body.lens as NonNullable<ExpandProjectBody['lens']>
      : 'everything';
    const segmentClause = access.session.segmentId == null
      ? isNull(projects.segmentId)
      : eq(projects.segmentId, access.session.segmentId);
    const [project] = await db.select({ id: projects.id, name: projects.name, description: projects.description, status: projects.status })
      .from(projects).where(and(
        eq(projects.id, projectId), eq(projects.tenantId, access.session.tenantId), segmentClause,
      )).limit(1);
    if (!project) return c.json({ error: 'Project not found or unavailable' }, 404);

    const includeDelivery = lens === 'everything' || lens === 'delivery';
    const taskSegment = access.session.segmentId == null ? isNull(tasks.segmentId) : eq(tasks.segmentId, access.session.segmentId);
    const definitionSegment = access.session.segmentId == null ? isNull(workflowDefinitions.segmentId) : eq(workflowDefinitions.segmentId, access.session.segmentId);
    const workflowSegment = access.session.segmentId == null ? isNull(workflows.segmentId) : eq(workflows.segmentId, access.session.segmentId);
    const [taskRows, definitionRows, workflowRows, agentRows] = includeDelivery ? await Promise.all([
      db.select({ id: tasks.id, title: tasks.title, description: tasks.description, status: tasks.status })
        .from(tasks).where(scopedToTenant(tasks, access.session.tenantId, eq(tasks.projectId, projectId), taskSegment)).orderBy(desc(tasks.updatedAt)).limit(100),
      db.select({ id: workflowDefinitions.id, name: workflowDefinitions.name, description: workflowDefinitions.description })
        .from(workflowDefinitions).where(and(eq(workflowDefinitions.projectId, projectId), eq(workflowDefinitions.tenantId, access.session.tenantId), definitionSegment)).orderBy(desc(workflowDefinitions.updatedAt)).limit(50),
      db.select({ id: workflows.id, description: workflows.description, status: workflows.status, workflowType: workflows.workflowType })
        .from(workflows).where(and(eq(workflows.projectId, projectId), eq(workflows.tenantId, access.session.tenantId), workflowSegment)).orderBy(desc(workflows.updatedAt)).limit(50),
      db.select({ id: ideAgents.id, name: ideAgents.name, title: ideAgents.title, status: ideAgents.status })
        .from(ideAgents).where(and(eq(ideAgents.projectId, projectId), eq(ideAgents.tenantId, access.session.tenantId))).orderBy(desc(ideAgents.updatedAt)).limit(50),
    ]) : [[], [], [], []];

    const resources = [
      ...taskRows.map((row) => ({ kind: 'task', resourceType: 'task', resourceId: String(row.id), title: row.title, subtitle: row.description, status: row.status })),
      ...definitionRows.map((row) => ({ kind: 'workflow', resourceType: 'workflow', resourceId: row.id, title: row.name, subtitle: row.description, status: 'Definition', workflowExecutable: true, resourceSubtype: 'definition' })),
      ...workflowRows.map((row) => ({ kind: 'workflow', resourceType: 'workflow', resourceId: row.id, title: row.description || `${row.workflowType} workflow`, subtitle: null, status: row.status, workflowExecutable: false, resourceSubtype: 'run' })),
      ...agentRows.map((row) => ({ kind: 'agent', resourceType: 'agent', resourceId: row.id, title: row.name, subtitle: row.title, status: row.status })),
    ];
    const generated = [
      ...(lens === 'everything' || lens === 'metrics' ? [{ key: `project:${projectId}:metrics`, kind: 'dashboard', title: `${project.name} delivery metrics`, status: 'Live' }] : []),
      ...(lens === 'everything' || lens === 'customer-feedback' ? [{ key: `project:${projectId}:feedback`, kind: 'featureSummary', title: `${project.name} requested features`, status: 'Evidence view' }] : []),
    ];
    return c.json({ project, lens, resources, generated, fetchedAt: new Date().toISOString() });
  });

  /**
   * Return the canonical PRD history for a project, grouped by ticket. Canvas
   * placement is deliberately irrelevant here: project-wide synthesis must read
   * every ticket-linked PRD even when the user currently has one object selected.
   */
  router.get('/:id/projects/:projectId/prd-context', async (c) => {
    const access = await requireSession(c, 'viewer');
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isInteger(projectId) || projectId <= 0) return c.json({ error: 'Invalid project id' }, 400);
    const segmentClause = access.session.segmentId == null
      ? isNull(projects.segmentId)
      : eq(projects.segmentId, access.session.segmentId);
    const [project] = await db.select({ id: projects.id, name: projects.name, description: projects.description, status: projects.status })
      .from(projects).where(and(
        eq(projects.id, projectId), eq(projects.tenantId, access.session.tenantId), segmentClause,
      )).limit(1);
    if (!project) return c.json({ error: 'Project not found or unavailable' }, 404);

    const taskSegment = access.session.segmentId == null ? isNull(tasks.segmentId) : eq(tasks.segmentId, access.session.segmentId);
    const [taskRows, projectSpecs, links] = await Promise.all([
      db.select({ id: tasks.id, key: tasks.key, title: tasks.title, description: tasks.description, status: tasks.status, updatedAt: tasks.updatedAt })
        .from(tasks).where(scopedToTenant(tasks, access.session.tenantId, eq(tasks.projectId, projectId), taskSegment)).orderBy(asc(tasks.id)),
      db.select({ id: specs.id, goal: specs.goal, status: specs.status, kind: specs.kind, prd: specs.prd, archSpec: specs.archSpec, taskList: specs.taskList, createdAt: specs.createdAt, updatedAt: specs.updatedAt })
        .from(specs).where(and(eq(specs.projectId, projectId), eq(specs.tenantId, access.session.tenantId))).orderBy(asc(specs.createdAt)),
      db.select({ taskId: taskSpecs.taskId, specId: taskSpecs.specId, isPrimary: taskSpecs.isPrimary })
        .from(taskSpecs)
        .innerJoin(tasks, eq(tasks.id, taskSpecs.taskId))
        .where(and(eq(tasks.projectId, projectId), eq(taskSpecs.tenantId, access.session.tenantId), taskSegment)),
    ]);
    const specIds = projectSpecs.map((spec) => spec.id);
    const versions = specIds.length ? await db.select({
      id: specVersions.id, specId: specVersions.specId, version: specVersions.version,
      prd: specVersions.prd, archSpec: specVersions.archSpec, taskList: specVersions.taskList,
      origin: specVersions.origin, frozen: specVersions.frozen, frozenAt: specVersions.frozenAt,
      createdBy: specVersions.createdBy, createdAt: specVersions.createdAt,
    }).from(specVersions).where(and(
      eq(specVersions.tenantId, access.session.tenantId), inArray(specVersions.specId, specIds),
    )).orderBy(asc(specVersions.specId), asc(specVersions.version)) : [];

    const versionsBySpec = new Map<string, typeof versions>();
    for (const version of versions) versionsBySpec.set(version.specId, [...(versionsBySpec.get(version.specId) ?? []), version]);
    const linksByTask = new Map<number, typeof links>();
    for (const link of links) linksByTask.set(link.taskId, [...(linksByTask.get(link.taskId) ?? []), link]);
    const specsById = new Map(projectSpecs.map((spec) => [spec.id, spec]));
    return c.json({
      project,
      tickets: taskRows.map((task) => ({
        ...task,
        prds: (linksByTask.get(task.id) ?? []).flatMap((link) => {
          const spec = specsById.get(link.specId);
          return spec ? [{ ...spec, isPrimary: link.isPrimary, versions: versionsBySpec.get(spec.id) ?? [] }] : [];
        }),
      })),
      projectPrds: projectSpecs.map((spec) => ({ ...spec, versions: versionsBySpec.get(spec.id) ?? [] })),
    });
  });

  router.post('/projects/:projectId/open', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isInteger(projectId) || projectId <= 0) return c.json({ error: 'Invalid project id' }, 400);
    const projectSegment = segmentId == null ? isNull(projects.segmentId) : eq(projects.segmentId, segmentId);
    const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId), projectSegment)).limit(1);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const sessionSegment = segmentId == null ? isNull(creationSessions.segmentId) : eq(creationSessions.segmentId, segmentId);
    const [existing] = await db.select({ id: creationSessions.id, objectId: creationSessionObjects.id })
      .from(creationSessionProjectLinks)
      .innerJoin(creationSessions, eq(creationSessions.id, creationSessionProjectLinks.sessionId))
      .innerJoin(creationSessionMembers, and(eq(creationSessionMembers.sessionId, creationSessions.id), eq(creationSessionMembers.userId, userId)))
      .innerJoin(creationSessionObjects, and(eq(creationSessionObjects.sessionId, creationSessions.id), eq(creationSessionObjects.resourceType, 'project'), eq(creationSessionObjects.resourceId, String(projectId))))
      .where(and(eq(creationSessionProjectLinks.projectId, projectId), eq(creationSessions.tenantId, tenantId), sessionSegment, eq(creationSessions.status, 'active')))
      .orderBy(desc(creationSessions.lastActivityAt)).limit(1);
    if (existing) return c.json({ sessionId: existing.id, objectId: existing.objectId, created: false });
    const sessionId = crypto.randomUUID();
    const objectId = crypto.randomUUID();
    const projectObject: GraphObjectInput = { id: objectId, kind: 'project', resourceType: 'project', resourceId: String(projectId), canvasData: { x: 160, y: 120, w: 320, h: 220 }, content: { kind: 'project', title: project.name } };
    // One batch, not a bare insert followed by one: the session row used to be
    // written OUTSIDE the batch, so a failed member insert left a board with an
    // owner nobody could be — the reason this path goes through the primitive.
    await db.batch([
      ...newCreationSessionStatements(db, {
        sessionId, tenantId, segmentId, title: project.name,
        objects: [projectObject], authorUserId: userId,
        eventType: 'session.created_from_project', eventPayload: { projectId },
      }).map((write) => write.statement),
      db.insert(creationSessionProjectLinks).values({ sessionId, projectId, addedBy: userId }),
    ] as unknown as Parameters<typeof db.batch>[0]);
    return c.json({ sessionId, objectId, created: true }, 201);
  });

  router.post('/ide-projects/:ideProjectId/open', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const ideProjectId = Number(c.req.param('ideProjectId'));
    if (!Number.isInteger(ideProjectId) || ideProjectId <= 0) return c.json({ error: 'Invalid build id' }, 400);
    const projectSegment = segmentId == null ? isNull(ideProjects.segmentId) : eq(ideProjects.segmentId, segmentId);
    const [build] = await db.select({
      id: ideProjects.id,
      name: ideProjects.name,
      modality: ideProjects.modality,
      status: ideProjects.status,
      storageProjectId: ideProjects.storageProjectId,
      containerProjectId: ideProjects.containerProjectId,
      workflowDefinitionId: ideProjects.workflowDefinitionId,
    }).from(ideProjects).where(and(
      eq(ideProjects.id, ideProjectId), eq(ideProjects.tenantId, tenantId), projectSegment,
    )).limit(1);
    if (!build) return c.json({ error: 'Build not found' }, 404);

    const [storageProject] = await db.select({ publicId: projects.publicId })
      .from(projects)
      .where(and(eq(projects.id, build.storageProjectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    if (!storageProject) return c.json({ error: 'Build storage project not found' }, 404);

    const kind = creationKindForModality(build.modality);
    const sessionSegment = segmentId == null ? isNull(creationSessions.segmentId) : eq(creationSessions.segmentId, segmentId);
    const [existing] = await db.select({ sessionId: creationSessions.id, objectId: creationSessionObjects.id })
      .from(creationSessionObjects)
      .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
      .innerJoin(creationSessionMembers, and(eq(creationSessionMembers.sessionId, creationSessions.id), eq(creationSessionMembers.userId, userId)))
      .where(and(
        eq(creationSessions.tenantId, tenantId), sessionSegment, eq(creationSessions.status, 'active'),
        eq(creationSessionObjects.kind, kind), eq(creationSessionObjects.resourceType, 'ideProject'),
        eq(creationSessionObjects.resourceId, String(build.id)),
      )).orderBy(desc(creationSessions.lastActivityAt)).limit(1);
    if (existing) return c.json({ ...existing, created: false });

    const sessionId = crypto.randomUUID();
    const objectId = crypto.randomUUID();
    const workflowObjectId = build.workflowDefinitionId ? crypto.randomUUID() : null;
    const objectContent = {
      kind, title: build.name, status: build.status, modality: build.modality,
      resourceId: `ideProject:${build.id}`,
      ideProjectId: build.id,
      storageProjectId: build.storageProjectId,
      storageProjectPublicId: storageProject.publicId,
      containerProjectId: build.containerProjectId,
    };
    const graphObjects: GraphObjectInput[] = [{
      id: objectId, kind, resourceType: 'ideProject', resourceId: String(build.id),
      canvasData: { x: 160, y: 120, w: 520, h: 340 }, content: objectContent,
    }];
    const graphConnections: GraphConnectionInput[] = [];
    if (workflowObjectId && build.workflowDefinitionId) {
      graphObjects.push({
        id: workflowObjectId, kind: 'workflow', resourceType: 'workflow', resourceId: build.workflowDefinitionId,
        canvasData: { x: 760, y: 170, w: 440, h: 280 },
        content: { kind: 'workflow', title: `${build.name} workflow`, status: 'Live resource', workflowExecutable: true, resourceSubtype: 'definition' },
      });
      graphConnections.push({ id: crypto.randomUUID(), sourceObjectId: workflowObjectId, targetObjectId: objectId, kind: 'control', label: 'builds' });
    }
    const statements: unknown[] = [
      ...newCreationSessionStatements(db, {
        sessionId, tenantId, segmentId, title: build.name,
        objects: graphObjects, connections: graphConnections, authorUserId: userId,
        eventType: 'session.created_from_build', eventObjectId: objectId,
        eventPayload: { ideProjectId: build.id, modality: build.modality, storageProjectId: build.storageProjectId },
      }).map((write) => write.statement),
      db.insert(creationSessionProjectLinks).values({ sessionId, projectId: build.storageProjectId, addedBy: userId }).onConflictDoNothing(),
    ];
    if (build.containerProjectId) statements.push(db.insert(creationSessionProjectLinks).values({ sessionId, projectId: build.containerProjectId, addedBy: userId }).onConflictDoNothing());
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    return c.json({ sessionId, objectId, created: true }, 201);
  });

  router.post('/resources/:resourceType/:resourceId/open', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const resourceType = c.req.param('resourceType');
    const resourceId = c.req.param('resourceId');
    let title: string;
    let kind: 'chat' | 'workflow' | 'agent';
    let projectId: number | null = null;
    let resourceContent: Record<string, unknown> = {};
    let initialTimeline: Array<{ id: number; role: string; content: string; createdAt: Date }> = [];
    if (resourceType === 'chat') {
      const chatId = Number(resourceId);
      if (!Number.isInteger(chatId) || chatId <= 0) return c.json({ error: 'Invalid chat id' }, 400);
      const chat = await resolveChatAccess(db, {
        chatId, tenantId, userId,
        selectExtra: { title: brainChats.title, projectId: brainChats.projectId, segmentId: brainChats.segmentId },
      });
      if (!chat || (chat.segmentId != null && chat.segmentId !== segmentId)) return c.json({ error: 'Chat not found' }, 404);
      title = String(chat.title || 'Brain session');
      projectId = chat.projectId == null ? null : Number(chat.projectId);
      kind = 'chat';
      initialTimeline = await db.select({ id: brainChatMessages.id, role: brainChatMessages.role, content: brainChatMessages.content, createdAt: brainChatMessages.createdAt })
        .from(brainChatMessages).where(eq(brainChatMessages.chatId, chatId)).orderBy(asc(brainChatMessages.seq), asc(brainChatMessages.id)).limit(500);
    } else if (resourceType === 'workflow') {
      if (!UUID_RE.test(resourceId)) return c.json({ error: 'Invalid workflow id' }, 400);
      const [definition] = await db.select({ id: workflowDefinitions.id, name: workflowDefinitions.name, projectId: workflowDefinitions.projectId })
        .from(workflowDefinitions).where(and(
          eq(workflowDefinitions.id, resourceId), eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.segmentId, segmentId),
        )).limit(1);
      if (!definition) return c.json({ error: 'Workflow not found' }, 404);
      title = definition.name;
      projectId = definition.projectId;
      kind = 'workflow';
      resourceContent = { workflowExecutable: true, resourceSubtype: 'definition' };
    } else if (resourceType === 'agent') {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(resourceId)) return c.json({ error: 'Invalid agent id' }, 400);
      const [agent] = await db.select({ id: ideAgents.id, name: ideAgents.name, title: ideAgents.title, bio: ideAgents.bio, baseModel: ideAgents.baseModel, status: ideAgents.status })
        .from(ideAgents).where(and(eq(ideAgents.id, resourceId), eq(ideAgents.tenantId, tenantId))).limit(1);
      if (!agent) return c.json({ error: 'Agent not found' }, 404);
      title = agent.name;
      projectId = null;
      kind = 'agent';
      resourceContent = { agentTitle: agent.title, instructions: agent.bio, model: agent.baseModel, agentStatus: agent.status };
    } else {
      return c.json({ error: 'Unsupported resource type' }, 400);
    }

    const sessionSegment = segmentId == null ? isNull(creationSessions.segmentId) : eq(creationSessions.segmentId, segmentId);
    const [existing] = await db.select({ sessionId: creationSessions.id, objectId: creationSessionObjects.id })
      .from(creationSessionObjects)
      .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
      .innerJoin(creationSessionMembers, and(eq(creationSessionMembers.sessionId, creationSessions.id), eq(creationSessionMembers.userId, userId)))
      .where(and(
        eq(creationSessions.tenantId, tenantId), sessionSegment, eq(creationSessions.status, 'active'),
        eq(creationSessionObjects.resourceType, resourceType), eq(creationSessionObjects.resourceId, resourceId),
      )).orderBy(desc(creationSessions.lastActivityAt)).limit(1);
    if (existing) return c.json({ ...existing, created: false });

    const sessionId = crypto.randomUUID();
    const objectId = crypto.randomUUID();
    const resourceObject: GraphObjectInput = {
      id: objectId, kind, resourceType, resourceId,
      canvasData: { x: 160, y: 120, w: kind === 'workflow' ? 460 : 320, h: 280 },
      content: { kind, title, status: 'Live resource', ...resourceContent },
    };
    const statements: unknown[] = newCreationSessionStatements(db, {
      sessionId, tenantId, segmentId, title,
      objects: [resourceObject], authorUserId: userId,
      eventType: `session.created_from_${resourceType}`, eventObjectId: objectId,
      eventPayload: { resourceType, resourceId, projectId },
    }).map((write) => write.statement);
    if (projectId) statements.push(db.insert(creationSessionProjectLinks).values({ sessionId, projectId, addedBy: userId }).onConflictDoNothing());
    if (initialTimeline.length) statements.push(db.insert(creationSessionTimeline).values(initialTimeline.map((message) => ({
      sessionId,
      clientMessageId: `legacy-chat:${resourceId}:${message.id}`,
      messageRole: ['user', 'assistant', 'system'].includes(message.role) ? message.role : 'system',
      body: message.content,
      metadata: { importedFrom: 'brain-chat', chatId: Number(resourceId), messageId: message.id },
      createdBy: message.role === 'user' ? userId : null,
      createdAt: message.createdAt,
    }))));
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    return c.json({ sessionId, objectId, created: true }, 201);
  });

  return router;
}

