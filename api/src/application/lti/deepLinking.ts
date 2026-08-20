/**
 * LTI Deep Linking — the picker handoff, and what may be picked.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────────────
 * A deep-linking launch is a signed `id_token` that arrives ONCE, on a POST from
 * the LMS, and is consumed immediately: the nonce is burned, so it cannot be
 * verified a second time. But choosing what to link to is an interactive act —
 * the instructor reads a list, ticks something, presses Done — and the request
 * that submits their choice is a NEW request from a page that has no id_token
 * and could not re-verify one if it did.
 *
 * So the launch is exchanged for a SHORT-LIVED, SIGNED PICKER TOKEN carrying
 * exactly what the response needs: which registration, which deployment, where
 * the platform wants the answer posted, its opaque `data`, which course board is
 * being picked from, and who is picking. Nothing else, and nothing that is not
 * already known to be true — the token is minted only from a launch that has
 * already passed signature, issuer, audience, nonce and expiry.
 *
 * ── WHY `signState` AND NOT A NEW TOKEN FORMAT ───────────────────────────────
 * This is the same problem the post-login redirect has, and it already has one
 * answer: `application/auth/sessionExchange.ts` mints an HMAC-signed, timestamped
 * envelope with `signState`/`verifyState` precisely so a short-lived handoff is
 * not a session JWT in a URL. A third token format would be a third freshness
 * window and a third place to get the signature check subtly wrong. This is the
 * second caller of that primitive, not a new primitive.
 *
 * The envelope is NOT a JWT and is useless as an API bearer: `verifyDeepLinkToken`
 * is the only thing that reads it, and every route that does re-derives the
 * registration and re-scopes every query to the tenant it names.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { creationSessionObjects, creationSessions, ltiContextBindings } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { signState, verifyState } from '../../infrastructure/auth/oauthState';
import {
  deepLinkingResponseClaims, type LtiContentItem, type LtiDeepLinkingSettings,
} from '../../domain/lti/ltiClaims';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { registrationFor, randomToken, signDeepLinkingResponse, type LtiRegistration } from './LtiService';
import { bridgeLaunch, findContextBinding } from './ltiLaunchBridge';
import type { LtiLaunchContext } from '../../domain/lti/ltiClaims';
import type { Env } from '../../env';

const SOURCE = 'application/lti/deepLinking.ts';

/**
 * How long the instructor has to choose.
 *
 * Thirty minutes, not the sixty seconds a post-login exchange gets: this is a
 * human reading a list of a course's work and deciding, often with a colleague,
 * and a picker that expires while they think produces a Done button that fails
 * with nothing to retry. It is still bounded, because the envelope names a
 * return URL the platform will accept a signed response at.
 */
const PICKER_TTL_MS = 30 * 60 * 1000;

/**
 * Everything the response needs, and nothing more.
 *
 * `tenantId` rides along so every query the picker makes is TENANT-SCOPED rather
 * than scoped by "whatever tenant the binding says" — a row deciding its own
 * access is the shape that leaks, and here there is no need for it: the launch
 * resolved the registration, and the registration knows its workspace.
 */
export interface DeepLinkPickerSession {
  registrationId: number | null;
  tenantId: number;
  issuer: string;
  clientId: string;
  deploymentId: string;
  /** The course board being picked from. Null when the course has never been
   *  launched here, which is a picker with nothing to offer but still a valid
   *  handoff — the instructor is told, rather than shown an error. */
  bindingId: number | null;
  userId: string | null;
  settings: LtiDeepLinkingSettings;
}

/** Mint the envelope the picker page carries. */
export async function mintDeepLinkToken(secret: string, session: DeepLinkPickerSession): Promise<string> {
  return signState(secret, session as unknown as Record<string, unknown>);
}

/** Read one back, or null when it is forged, tampered with or stale. */
export async function readDeepLinkToken(secret: string, token: string): Promise<DeepLinkPickerSession | null> {
  const parsed = await verifyState<Record<string, unknown>>(secret, token, PICKER_TTL_MS);
  if (!parsed) return null;
  const settings = parsed.settings as LtiDeepLinkingSettings | undefined;
  if (!settings?.returnUrl || typeof parsed.tenantId !== 'number') return null;
  return {
    registrationId: typeof parsed.registrationId === 'number' ? parsed.registrationId : null,
    tenantId: parsed.tenantId,
    issuer: String(parsed.issuer ?? ''),
    clientId: String(parsed.clientId ?? ''),
    deploymentId: String(parsed.deploymentId ?? ''),
    bindingId: typeof parsed.bindingId === 'number' ? parsed.bindingId : null,
    userId: typeof parsed.userId === 'string' ? parsed.userId : null,
    settings,
  };
}

export type DeepLinkStartResult =
  | { ok: true; token: string; session: DeepLinkPickerSession }
  | { ok: false; status: number; error: string };

/**
 * Turn a verified `LtiDeepLinkingRequest` into a picker handoff.
 *
 * ── WHY THIS RUNS THE LAUNCH BRIDGE ──────────────────────────────────────────
 * An instructor reaches deep linking from "add external tool content", often
 * BEFORE anyone has ever launched the course. Minting a picker without running
 * the bridge would show them an empty list and no way to fill it — so the same
 * provisioning a resource-link launch does happens here: the account, the
 * workspace membership and the course board. Only the destination differs. The
 * bridge is idempotent on all three, so a deep-linking launch into an
 * already-bound course adds nothing.
 *
 * A deep-linking request has no resource link, so no assignment object is
 * created by this path — which is correct: the instructor has not chosen one yet.
 * That is the entire point of the picker.
 */
export async function beginDeepLink(
  env: Env,
  db: Db,
  registration: LtiRegistration,
  context: LtiLaunchContext,
  settings: LtiDeepLinkingSettings | null,
): Promise<DeepLinkStartResult> {
  if (!settings) {
    return {
      ok: false,
      status: 400,
      error: 'This LMS asked us to pick content but did not say where to send the selection back to, so there is nothing the picker could return. Its deep-linking placement is misconfigured.',
    };
  }
  // Deep linking ADDS COURSE CONTENT. A launch whose roles say `learn` is a
  // student, and a student who could add content could add a link to anything
  // this tool will serve.
  if (context.capability === 'learn') {
    return {
      ok: false,
      status: 403,
      error: 'Only teaching staff can add content to a course, and this launch arrived with a student role.',
    };
  }

  const bridged = await bridgeLaunch(db, registration, context);
  if (!bridged.ok) return bridged;

  const binding = await findContextBinding(db, context);

  const session: DeepLinkPickerSession = {
    registrationId: registration.id,
    tenantId: registration.tenantId,
    issuer: registration.issuer,
    clientId: registration.clientId,
    deploymentId: context.deploymentId,
    bindingId: binding?.id ?? null,
    userId: bridged.userId,
    settings,
  };
  return { ok: true, token: await mintDeepLinkToken(env.JWT_SECRET, session), session };
}

// ---------------------------------------------------------------------------
// What may be linked
// ---------------------------------------------------------------------------

/**
 * The object kinds an LMS may be handed a link to, most useful first.
 *
 * This is an ALLOW-LIST and not a deny-list, deliberately. A link created here
 * is launched by every student in the course, so the question is not "is this
 * kind harmful" but "is this kind FOR them" — and the canvas gains academic
 * kinds regularly, so a deny-list would silently start offering each new one.
 *
 * `assignment` is first because it is the only kind that binds to a resource
 * link, an AGS line item and a per-learner board — linking one is what makes the
 * whole grade round-trip work, and the rest are reading material.
 *
 * Never linkable, and each for its own reason:
 *   · `cohort`         — it IS the roster, plus every mark derived from it.
 *   · `submission`     — one person's work. A link to it is a link for everyone.
 *   · `gradebook`      — the whole cohort's marks.
 *   · `accommodation`  — disability provisions. The most sensitive row on the board.
 *   · `feedbackBank`   — a marker's working notes, written to be reused, not read.
 */
export const LINKABLE_KINDS = [
  'assignment',
  'lecture',
  'poll',
  'rubric',
  'officeHours',
  'curriculumMap',
  'protocol',
  'literatureReview',
] as const;

export interface LinkableObject {
  id: string;
  kind: string;
  title: string;
  /** One line of context — the status the card already shows. */
  status: string;
}

const kindRank = (kind: string): number => {
  const index = (LINKABLE_KINDS as readonly string[]).indexOf(kind);
  return index < 0 ? LINKABLE_KINDS.length : index;
};

const readString = (content: unknown, key: string): string => {
  if (!content || typeof content !== 'object') return '';
  const value = (content as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.slice(0, 300) : '';
};

/**
 * The board bound to this course, and the revision its objects are at.
 *
 * The revision is what makes the object read below cacheable AT ALL. There is no
 * invalidation seam on canvas object writes — nothing publishes "this board's
 * objects changed" — so a TTL would mean an instructor who adds an assignment
 * and immediately opens the LMS picker does not see it, which is precisely the
 * minute they will do it in. Folding `canvasRevision` into the cache key is the
 * version-token pattern the cache helper documents: a write bumps the revision,
 * the key changes, and the stale entry ages out on its own rather than being
 * served.
 */
async function boundBoard(
  db: Db,
  tenantId: number,
  bindingId: number,
): Promise<{ sessionId: string; revision: number } | null> {
  const [binding] = await db
    .select({ sessionId: ltiContextBindings.sessionId })
    .from(ltiContextBindings)
    .where(scopedToTenant(ltiContextBindings, tenantId, eq(ltiContextBindings.id, bindingId)))
    .limit(1);
  if (!binding) return null;

  const [session] = await db
    .select({ revision: creationSessions.canvasRevision })
    .from(creationSessions)
    .where(scopedToTenant(creationSessions, tenantId, eq(creationSessions.id, binding.sessionId)))
    .limit(1);
  if (!session) return null;
  return { sessionId: binding.sessionId, revision: Number(session.revision ?? 0) };
}

/**
 * What the instructor may pick from this course's board.
 *
 * Takes `env` as well as `db` because the read is cached — the picker is opened
 * repeatedly while a module is built and the answer only changes when the board
 * does.
 */
export async function listLinkableObjects(
  env: Env,
  db: Db,
  tenantId: number,
  bindingId: number,
): Promise<readonly LinkableObject[]> {
  const board = await boundBoard(db, tenantId, bindingId);
  if (!board) return [];

  return getOrSetCached<readonly LinkableObject[]>(
    env,
    `lti:deep-link:targets:${tenantId}:${bindingId}:${board.revision}`,
    async () => {
      const rows = await db
        .select({ id: creationSessionObjects.id, kind: creationSessionObjects.kind, content: creationSessionObjects.content })
        .from(creationSessionObjects)
        .where(and(
          eq(creationSessionObjects.sessionId, board.sessionId),
          inArray(creationSessionObjects.kind, [...LINKABLE_KINDS]),
        ))
        // Bounded: a picker is a list a person reads, and a course board with
        // more than 200 linkable objects on it is one where the answer is a
        // search box, not a longer list.
        .limit(200);

      return rows
        .map((row) => ({
          id: row.id,
          kind: row.kind,
          title: readString(row.content, 'title') || row.kind,
          status: readString(row.content, 'status'),
        }))
        .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.title.localeCompare(b.title));
    },
  );
}

// ---------------------------------------------------------------------------
// The answer that goes back
// ---------------------------------------------------------------------------

/**
 * One content item per chosen object.
 *
 * The object id rides BOTH the URL and the `custom` parameters on purpose. The
 * URL is what the platform stores and what a launch's `target_link_uri` will be,
 * and `custom` is what it replays on every launch as a claim — and platforms
 * differ on which of the two survives a course copy. Sending both means the
 * link still names its object after a module is rolled over into a new term,
 * which is the moment a link that only carried a query string goes blank.
 */
export function contentItemsFor(
  objects: readonly LinkableObject[],
  launchUrl: string,
): LtiContentItem[] {
  return objects.map((object) => ({
    type: 'ltiResourceLink' as const,
    url: `${launchUrl}?object=${encodeURIComponent(object.id)}`,
    title: object.title.slice(0, 255),
    ...(object.status ? { text: object.status } : {}),
    custom: { builderforce_object_id: object.id, builderforce_object_kind: object.kind },
  }));
}

export type DeepLinkResponseResult =
  | { ok: true; returnUrl: string; jwt: string }
  | { ok: false; status: number; error: string };

/**
 * Turn a selection into the signed response the browser posts back.
 *
 * Every chosen id is RE-READ from the board rather than trusted from the request
 * body: the ids arrive from a page, and a page can be edited. Re-reading through
 * `listLinkableObjects` means an id that is not on this course's board, or is of
 * a kind that may not be linked, cannot become a content item — the allow-list
 * is enforced where the answer is built, not only where the list was rendered.
 */
export async function buildDeepLinkResponse(
  env: Env,
  db: Db,
  session: DeepLinkPickerSession,
  objectIds: readonly string[],
  launchUrl: string,
): Promise<DeepLinkResponseResult> {
  if (!objectIds.length) {
    return { ok: false, status: 400, error: 'Choose at least one item to add.' };
  }
  if (!session.settings.acceptMultiple && objectIds.length > 1) {
    return { ok: false, status: 400, error: 'This LMS accepts one item per selection.' };
  }
  if (session.bindingId == null) {
    return { ok: false, status: 409, error: 'This course has no Builderforce board yet, so there is nothing to link to.' };
  }

  const available = await listLinkableObjects(env, db, session.tenantId, session.bindingId);
  const wanted = new Set(objectIds);
  const chosen = available.filter((object) => wanted.has(object.id));
  if (chosen.length !== wanted.size) {
    return { ok: false, status: 400, error: 'One of the chosen items is no longer on this course board.' };
  }

  const registration = await registrationFor(env, session.issuer, session.clientId);
  if (!registration) {
    return { ok: false, status: 404, error: 'Unknown platform issuer.' };
  }

  const claims = deepLinkingResponseClaims({
    clientId: registration.clientId,
    issuer: registration.issuer,
    deploymentId: session.deploymentId,
    nonce: randomToken(16),
    data: session.settings.data,
    contentItems: contentItemsFor(chosen, launchUrl),
    nowSeconds: Math.floor(Date.now() / 1000),
  });

  let jwt: string | null = null;
  try {
    jwt = await signDeepLinkingResponse(env, registration, claims);
  } catch (error) {
    // A key that will not import is a registration problem, not an instructor's
    // problem — report it and tell them something they can act on.
    reportCaughtError(error, { source: SOURCE, operation: 'signDeepLinkingResponse', level: 'error' });
    jwt = null;
  }
  if (!jwt) {
    return {
      ok: false,
      status: 502,
      error: 'This registration’s signing key could not be used, so the selection cannot be sent back. Re-add or rotate the key from Settings → Security.',
    };
  }

  return { ok: true, returnUrl: session.settings.returnUrl, jwt };
}
