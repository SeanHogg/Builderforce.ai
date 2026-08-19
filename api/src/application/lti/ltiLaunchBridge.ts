/**
 * The half of LTI that was missing: a launch that ARRIVES SOMEWHERE.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `POST /api/lti/launch` verified a signed `id_token` correctly and then returned
 * JSON that nothing consumed. There was no route the LMS's `target_link_uri`
 * landed a person on, no session it established, and no board it opened. So a
 * `cohort`'s `ltiIssuer` / `ltiMembershipsUrl` and an `assignment`'s
 * `ltiLineItemUrl` — the fields `cohort.import` and `submission.mark` call the
 * roster and grade services with — could only be set by an admin pasting values
 * out of an LMS configuration screen. The protocol worked; nobody could reach it.
 *
 * ── THE THREE DECISIONS THIS MODULE RECORDS ──────────────────────────────────
 *
 * 1. A LAUNCH RESUMES A BOARD, KEYED ON THE COURSE, and creates one on first
 *    launch. Not on the resource link: a course-navigation launch and an
 *    assignment launch are two doors into the same module, and a board per link
 *    would give one cohort two rosters that drift. The resource link still
 *    matters — it selects the `assignment` object ON that board, so a second
 *    assignment adds an object and never a second board.
 *
 * 2. A LAUNCHING USER WITH NO ACCOUNT IS PROVISIONED, bound to the platform's
 *    `sub` rather than to their email. `sub` is the only stable identifier a
 *    platform promises: an email changes with a surname and may not be released
 *    at all. The binding rides `oauth_accounts` — provider `lti`, account id
 *    `<issuer>|<sub>` — because that table already IS "this external identity is
 *    this user", and a `lti_users` table would be the second answer to it.
 *
 *    A launch with NO EMAIL is refused, with the reason. Some platforms are
 *    configured to release nothing, and synthesising `lti-<hash>@invalid` to get
 *    past a NOT NULL would put an unreachable address on a real account and make
 *    every later message to that person silently undeliverable.
 *
 * 3. ONLY A STAFF LAUNCH OPENS THE COHORT BOARD. `teach` and `assist` land on it;
 *    `learn` does not, and is told why. This is not a stub — the cohort board
 *    carries the whole roster and every submission's mark, so opening it for a
 *    student would disclose their classmates' grades. A learner reaches their own
 *    work through `assignment.distribute`, which is what that action is for.
 */

import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  creationSessionEvents,
  creationSessionMembers,
  creationSessionObjects,
  creationSessionSnapshots,
  creationSessions,
  ltiContextBindings,
  ltiResourceBindings,
  oauthAccounts,
  tenantMembers,
  users,
} from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import type { LtiLaunchContext } from '../../domain/lti/ltiClaims';
import type { LtiRegistration } from './LtiService';

/** The provider value on `oauth_accounts`. Fixed and short: the column is
 *  varchar(50) and an issuer URL does not fit, so the issuer goes in the account
 *  id where the unique index on (provider, provider_account_id) still keeps two
 *  platforms' identically-numbered subjects apart. */
const LTI_PROVIDER = 'lti';

const ltiAccountId = (issuer: string, subject: string): string => `${issuer}|${subject}`.slice(0, 255);

export type LaunchBridgeResult =
  | { ok: true; userId: string; sessionId: string; redirect: string; capability: string }
  | { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// Who launched
// ---------------------------------------------------------------------------

/** Username from an email, deduped. Mirrors the OAuth callback's own generator —
 *  same alphabet, same fallback — because two account-creation paths that produce
 *  differently-shaped usernames make the handle look arbitrary to the user. */
async function generateUsername(db: Db, email: string): Promise<string> {
  const base = email.split('@')[0]!.replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 20);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 16)}_${crypto.randomUUID().slice(0, 4)}`;
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, candidate)).limit(1);
    if (!taken) return candidate;
  }
  return `user_${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * The Builderforce account behind an LTI subject, creating one if needed.
 *
 * Order matters and is the same order the OAuth callback uses: the external
 * binding first (authoritative), then the email (account linking), then creation.
 * Matching on email BEFORE the binding would let a platform that re-used an
 * address take over an existing account.
 */
async function resolveLaunchUser(
  db: Db,
  context: LtiLaunchContext,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const accountId = ltiAccountId(context.issuer, context.subject);
  const [bound] = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, LTI_PROVIDER), eq(oauthAccounts.providerAccountId, accountId)))
    .limit(1);
  if (bound) return { ok: true, userId: bound.userId };

  const email = context.email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return {
      ok: false,
      status: 403,
      error: 'This LMS did not release an email address with the launch, so there is nobody to sign in. Set the tool’s privacy level to "public" in the LMS and launch again.',
    };
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  let userId = existing?.id ?? '';
  if (!userId) {
    userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      email,
      username: await generateUsername(db, email),
      displayName: context.name || email,
      passwordHash: null,
      apiKeyHash: null,
      // The platform authenticated them; that is exactly what OAuth vouching is,
      // so the account is verified on creation and skips the signup OTP gate.
      emailVerifiedAt: new Date(),
    });
  }

  await db
    .insert(oauthAccounts)
    .values({
      userId,
      provider: LTI_PROVIDER,
      providerAccountId: accountId,
      email,
      displayName: context.name || email,
    })
    .onConflictDoNothing({ target: [oauthAccounts.provider, oauthAccounts.providerAccountId] });

  return { ok: true, userId };
}

/**
 * Make sure a staff launcher can actually open the workspace their board is in.
 *
 * `viewer` deliberately, and never higher: a launch proves somebody teaches a
 * course in an LMS, which is not a claim about what they may do to the rest of
 * the institution's workspace. An owner promotes them if that is what they meant.
 */
async function ensureWorkspaceMembership(db: Db, tenantId: number, userId: string): Promise<void> {
  const [member] = await db
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(scopedToTenant(tenantMembers, tenantId, eq(tenantMembers.userId, userId)))
    .limit(1);
  if (member) return;
  await db.insert(tenantMembers).values({ tenantId, userId, role: 'viewer' });
}

// ---------------------------------------------------------------------------
// Where they land
// ---------------------------------------------------------------------------

/** The `cohort` object's content, built from what the launch actually carried.
 *  `ltiIssuer` and `ltiMembershipsUrl` are the two fields `cohort.import` needs
 *  before it can pull a roster instead of reading a CSV — which is the entire
 *  point of doing this at launch rather than asking somebody to paste them. */
function cohortContent(context: LtiLaunchContext): Record<string, unknown> {
  return {
    title: context.contextTitle || context.contextLabel || 'Cohort',
    subtitle: context.contextLabel,
    status: 'noRoster',
    courseCode: context.contextLabel,
    ltiIssuer: context.issuer,
    ...(context.membershipsUrl ? { ltiMembershipsUrl: context.membershipsUrl } : {}),
  };
}

/** The `assignment` object's content. `ltiLineItemUrl` is present only when the
 *  platform granted the score scope — absent is the honest state, and it is what
 *  stops `submission.mark` claiming it pushed a grade that went nowhere. */
function assignmentContent(context: LtiLaunchContext): Record<string, unknown> {
  return {
    title: context.resourceLinkTitle || 'Assignment',
    status: 'draftBrief',
    cohortRef: context.contextLabel || context.contextTitle,
    ...(context.lineItemUrl ? { ltiLineItemUrl: context.lineItemUrl } : {}),
  };
}

/** Canvas placement for an object created without a person dragging it. Objects
 *  are laid out in a column so a course with six assignments does not stack them
 *  all on the origin. */
const placement = (index: number) => ({ x: 80 + (index % 3) * 360, y: 80 + Math.floor(index / 3) * 260, w: 320, h: 220 });

async function createBoard(
  db: Db,
  registration: LtiRegistration,
  context: LtiLaunchContext,
  userId: string,
): Promise<{ sessionId: string; cohortObjectId: string }> {
  const segmentId = await resolveSegment(db, registration.tenantId);
  const sessionId = crypto.randomUUID();
  const cohortObjectId = crypto.randomUUID();
  const title = context.contextTitle || context.contextLabel || 'Course';
  const objects = [{
    id: cohortObjectId,
    sessionId,
    kind: 'cohort',
    canvasData: placement(0),
    content: cohortContent(context),
    searchText: `${title} ${context.contextLabel}`.trim().slice(0, 2000),
    createdBy: userId,
    updatedBy: userId,
  }];

  await db.batch([
    db.insert(creationSessions).values({
      id: sessionId, tenantId: registration.tenantId, segmentId, title,
      description: `Bound to ${registration.label} — ${context.contextLabel || context.contextId}.`,
      createdBy: userId, updatedBy: userId, canvasRevision: 1, mode: 'work',
    }),
    db.insert(creationSessionMembers).values({ sessionId, userId, role: 'owner', invitedBy: userId }),
    db.insert(creationSessionObjects).values(objects),
    db.insert(creationSessionSnapshots).values({
      sessionId, revision: 1,
      graph: { objects: objects.map((object) => ({ id: object.id, kind: object.kind, canvasData: object.canvasData, content: object.content })), connections: [] },
      createdBy: userId,
    }),
    db.insert(creationSessionEvents).values({
      sessionId, revision: 1, actorType: 'user', actorRef: userId, eventType: 'session.launched',
      payload: { issuer: context.issuer, contextId: context.contextId, deploymentId: context.deploymentId },
    }),
  ] as unknown as Parameters<typeof db.batch>[0]);

  return { sessionId, cohortObjectId };
}

/**
 * Resolve the board for this course, creating it on the first launch.
 *
 * Re-reads the binding after a create race: two instructors clicking Launch at
 * the same moment would otherwise get two boards for one course, which is the
 * exact drift `uq_lti_context_bindings_context` exists to prevent — so the unique
 * index is allowed to decide, and the loser adopts the winner's board.
 */
async function resolveBoard(
  db: Db,
  registration: LtiRegistration,
  context: LtiLaunchContext,
  userId: string,
): Promise<{ bindingId: number; sessionId: string; cohortObjectId: string | null }> {
  const [existing] = await db
    .select({ id: ltiContextBindings.id, sessionId: ltiContextBindings.sessionId, cohortObjectId: ltiContextBindings.cohortObjectId })
    .from(ltiContextBindings)
    // A launch carries no session, so the row reports its own tenant — the same
    // declared cross-tenant read the registration lookup makes, with the signed
    // (issuer, deployment, context) triple as the access predicate.
    .where(acrossTenants(
      ltiContextBindings,
      'share_token',
      eq(ltiContextBindings.issuer, context.issuer),
      eq(ltiContextBindings.deploymentId, context.deploymentId),
      eq(ltiContextBindings.contextId, context.contextId),
    ))
    .limit(1);

  if (existing) {
    // The service URLs are re-stamped on every launch: a platform re-issues them
    // when a course is copied into a new term, and a stale membership URL is a
    // roster import that 404s with no explanation.
    await db
      .update(ltiContextBindings)
      .set({ membershipsUrl: context.membershipsUrl, updatedAt: new Date() })
      .where(scopedToTenant(ltiContextBindings, registration.tenantId, eq(ltiContextBindings.id, existing.id)));
    if (existing.cohortObjectId) {
      await db
        .update(creationSessionObjects)
        .set({ content: cohortContent(context), updatedAt: new Date() })
        .where(and(
          eq(creationSessionObjects.id, existing.cohortObjectId),
          eq(creationSessionObjects.sessionId, existing.sessionId),
        ));
    }
    await joinBoard(db, existing.sessionId, userId);
    return { bindingId: existing.id, sessionId: existing.sessionId, cohortObjectId: existing.cohortObjectId };
  }

  const created = await createBoard(db, registration, context, userId);
  const [binding] = await db
    .insert(ltiContextBindings)
    .values({
      tenantId: registration.tenantId,
      registrationId: registration.id ?? 0,
      issuer: context.issuer,
      deploymentId: context.deploymentId,
      contextId: context.contextId,
      contextLabel: context.contextLabel,
      contextTitle: context.contextTitle,
      sessionId: created.sessionId,
      cohortObjectId: created.cohortObjectId,
      membershipsUrl: context.membershipsUrl,
    })
    .onConflictDoNothing({ target: [ltiContextBindings.issuer, ltiContextBindings.deploymentId, ltiContextBindings.contextId] })
    .returning({ id: ltiContextBindings.id });

  if (binding) return { bindingId: binding.id, sessionId: created.sessionId, cohortObjectId: created.cohortObjectId };

  // Lost the race. Adopt the winner's board and drop ours — an orphan board with
  // one cohort object is worse than a wasted uuid.
  await db.delete(creationSessions).where(scopedToTenant(creationSessions, registration.tenantId, eq(creationSessions.id, created.sessionId)));
  const [winner] = await db
    .select({ id: ltiContextBindings.id, sessionId: ltiContextBindings.sessionId, cohortObjectId: ltiContextBindings.cohortObjectId })
    .from(ltiContextBindings)
    .where(acrossTenants(
      ltiContextBindings,
      'share_token',
      eq(ltiContextBindings.issuer, context.issuer),
      eq(ltiContextBindings.deploymentId, context.deploymentId),
      eq(ltiContextBindings.contextId, context.contextId),
    ))
    .limit(1);
  if (!winner) throw new Error('LTI context binding vanished between insert and read.');
  await joinBoard(db, winner.sessionId, userId);
  return { bindingId: winner.id, sessionId: winner.sessionId, cohortObjectId: winner.cohortObjectId };
}

/** A second instructor launching into an existing course board joins it as an
 *  editor. `onConflictDoNothing` so a repeat launch is not a role reset — the
 *  board's owner must not be demoted by their own second click. */
async function joinBoard(db: Db, sessionId: string, userId: string): Promise<void> {
  await db
    .insert(creationSessionMembers)
    .values({ sessionId, userId, role: 'editor', invitedBy: userId })
    .onConflictDoNothing({ target: [creationSessionMembers.sessionId, creationSessionMembers.userId] });
}

/**
 * The `assignment` object for this resource link, created on first launch of it.
 *
 * Skipped entirely when the launch carries no resource link — a
 * course-navigation placement has none, and inventing an assignment called
 * "Assignment" for it would put an empty brief on every cohort board.
 */
async function resolveAssignment(
  db: Db,
  registration: LtiRegistration,
  context: LtiLaunchContext,
  bindingId: number,
  sessionId: string,
  userId: string,
): Promise<void> {
  if (!context.resourceLinkId) return;

  const [existing] = await db
    .select({ id: ltiResourceBindings.id, assignmentObjectId: ltiResourceBindings.assignmentObjectId })
    .from(ltiResourceBindings)
    .where(scopedToTenant(
      ltiResourceBindings,
      registration.tenantId,
      eq(ltiResourceBindings.bindingId, bindingId),
      eq(ltiResourceBindings.resourceLinkId, context.resourceLinkId),
    ))
    .limit(1);

  if (existing) {
    await db
      .update(ltiResourceBindings)
      .set({ lineItemUrl: context.lineItemUrl, resourceLinkTitle: context.resourceLinkTitle, updatedAt: new Date() })
      .where(scopedToTenant(ltiResourceBindings, registration.tenantId, eq(ltiResourceBindings.id, existing.id)));
    if (existing.assignmentObjectId) {
      const [current] = await db
        .select({ content: creationSessionObjects.content })
        .from(creationSessionObjects)
        .where(and(eq(creationSessionObjects.id, existing.assignmentObjectId), eq(creationSessionObjects.sessionId, sessionId)))
        .limit(1);
      // MERGED, not replaced: the brief, rubric and deadline on an assignment are
      // an instructor's work, and a re-launch that overwrote them with the two
      // fields an LMS knows about would delete it.
      const merged = {
        ...(current?.content && typeof current.content === 'object' ? current.content as Record<string, unknown> : {}),
        ...(context.lineItemUrl ? { ltiLineItemUrl: context.lineItemUrl } : {}),
        ...(context.resourceLinkTitle ? { title: context.resourceLinkTitle } : {}),
      };
      await db
        .update(creationSessionObjects)
        .set({ content: merged, updatedAt: new Date() })
        .where(and(eq(creationSessionObjects.id, existing.assignmentObjectId), eq(creationSessionObjects.sessionId, sessionId)));
    }
    return;
  }

  // An aggregate, not a page of rows counted in memory: a board that has been
  // launched into for three terms can hold hundreds of objects, and loading them
  // all to work out where to put one more is the unbounded-read anti-pattern.
  const [placed] = await db
    .select({ value: count() })
    .from(creationSessionObjects)
    .where(eq(creationSessionObjects.sessionId, sessionId));
  const existingCount = Number(placed?.value ?? 0);

  const assignmentObjectId = crypto.randomUUID();
  await db.insert(creationSessionObjects).values({
    id: assignmentObjectId,
    sessionId,
    kind: 'assignment',
    canvasData: placement(existingCount),
    content: assignmentContent(context),
    searchText: (context.resourceLinkTitle || 'Assignment').slice(0, 2000),
    createdBy: userId,
    updatedBy: userId,
  });
  await db
    .insert(ltiResourceBindings)
    .values({
      tenantId: registration.tenantId,
      bindingId,
      resourceLinkId: context.resourceLinkId,
      resourceLinkTitle: context.resourceLinkTitle,
      assignmentObjectId,
      lineItemUrl: context.lineItemUrl,
    })
    .onConflictDoNothing({ target: [ltiResourceBindings.bindingId, ltiResourceBindings.resourceLinkId] });
}

// ---------------------------------------------------------------------------
// The whole bridge
// ---------------------------------------------------------------------------

/**
 * Turn a VERIFIED launch into a user and a board.
 *
 * The caller has already checked the signature, the issuer, the audience, the
 * nonce and the expiry. Nothing here re-verifies any of that, and nothing here
 * accepts an unverified context — the type is the contract, and the only
 * producer of an `LtiLaunchContext` is `verifyLaunch`.
 */
export async function bridgeLaunch(
  db: Db,
  registration: LtiRegistration,
  context: LtiLaunchContext,
): Promise<LaunchBridgeResult> {
  if (context.capability === 'learn') {
    return {
      ok: false,
      status: 403,
      error: 'This link opens the cohort board, which carries the whole roster and every mark on it. Your instructor distributes your own copy of the work — open the assignment in your LMS once they have.',
    };
  }
  if (!registration.tenantId) {
    return {
      ok: false,
      status: 409,
      error: 'This registration is not bound to a workspace, so a launch has nowhere to land. Re-add it from Settings → Security.',
    };
  }

  const resolved = await resolveLaunchUser(db, context);
  if (!resolved.ok) return resolved;

  await ensureWorkspaceMembership(db, registration.tenantId, resolved.userId);
  const board = await resolveBoard(db, registration, context, resolved.userId);
  await resolveAssignment(db, registration, context, board.bindingId, board.sessionId, resolved.userId);

  return {
    ok: true,
    userId: resolved.userId,
    sessionId: board.sessionId,
    redirect: `/create/${board.sessionId}`,
    capability: context.capability,
  };
}
