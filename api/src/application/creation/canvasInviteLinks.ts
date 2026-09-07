/**
 * CANVAS INVITE LINKS — "send someone the link" for a board that belongs to a workspace.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * A logged-OUT visitor could already share a canvas the way people actually share
 * things: start a room, copy a URL, send it. A signed-IN owner — the person whose board
 * is worth sharing — could not. Their only door was an address field: type an email,
 * we mail a one-time token, and the recipient must sign in AS THAT ADDRESS to get in.
 * So the product's sharing model got strictly worse the moment somebody signed up, and
 * the two halves disagreed about what an invitation even is.
 *
 * A link invitation is the same grant, unaddressed. It hangs off the board's registry
 * object as a `share_links` row, exactly as an emailed invitation hangs off it as an
 * `invitations` row — same object, same revocation surface, same plan cap — so a link
 * cannot grant access to something the invite panel never showed.
 *
 * ── WHY THE ROLE IS THE SHARE SCOPE ──────────────────────────────────────────────
 * `share_links.scope` is already view | comment | edit. Those are three of the five
 * board roles, and the two it cannot spell are exactly the two that must never travel
 * in a URL: `runner` spends the workspace's tokens, and `owner` can give the board
 * away. So the mapping is total in the direction that matters and the missing values
 * are a refusal, not an omission — {@link CANVAS_LINK_ROLES} is the whole vocabulary a
 * link may carry, and the UI reads it from here rather than listing roles of its own.
 *
 * ── WHAT A CLAIM DOES ────────────────────────────────────────────────────────────
 * It adds one `creation_session_members` row and one collaborator membership. Whether
 * the claimer is a signed-in teammate or somebody who has just refused to sign up
 * changes only WHERE the identity came from (`canvasGuestAccount.ts`); everything
 * downstream — presence, comments, the relay principal, the plan cap — is the path
 * that already existed.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { creationSessionMembers, creationSessions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  createShareLink,
  getObject,
  getObjectShares,
  peekShareToken,
  resolveShareToken,
  revokeShareLink,
} from '../kernel/ObjectRegistry';
import { ensureSessionObject, findSessionObject, type SessionRef } from './sessionObjectRef';
import { requireSessionRole, tenantRoleForSessionRole } from './sessionAccess';
import { collaboratorCapacity, type CollaboratorCapacityRefusal } from './canvasCollaboratorCapacity';
import { createGuestUser, seatAsCollaborator, type CanvasGuestIdentity } from './canvasGuestAccount';

/** The board roles a LINK may carry. Not `runner` (spends the workspace's tokens) and
 *  not `owner` (can give the board away) — neither belongs in something forwardable. */
export const CANVAS_LINK_ROLES = ['viewer', 'commenter', 'editor'] as const;
export type CanvasLinkRole = (typeof CANVAS_LINK_ROLES)[number];

type ShareScope = 'view' | 'comment' | 'edit';

const SCOPE_BY_ROLE: Record<CanvasLinkRole, ShareScope> = {
  viewer: 'view', commenter: 'comment', editor: 'edit',
};
const ROLE_BY_SCOPE: Record<ShareScope, CanvasLinkRole> = {
  view: 'viewer', comment: 'commenter', edit: 'editor',
};

/** Narrow anything to a link role, or null. The refusal is the point: a caller asking
 *  for `owner` is asking for something a URL must not be able to say. */
export function asCanvasLinkRole(value: unknown): CanvasLinkRole | null {
  return (CANVAS_LINK_ROLES as readonly string[]).includes(value as string) ? value as CanvasLinkRole : null;
}

export function shareScopeForLinkRole(role: CanvasLinkRole): ShareScope {
  return SCOPE_BY_ROLE[role];
}

/** A stored scope back to a board role. Anything unrecognised reads as the least
 *  access a link can grant — an unreadable scope must never widen into an editor. */
export function linkRoleForShareScope(scope: string): CanvasLinkRole {
  return ROLE_BY_SCOPE[scope as ShareScope] ?? 'viewer';
}

/** THE path a canvas invite link points at. One definition: the mint returns it, and
 *  the browser only prefixes an origin, so a link can never be built for a route that
 *  does not exist. */
export function canvasJoinPath(token: string): string {
  return `/create/join/${token}`;
}

/** A share token is two concatenated de-hyphenated UUIDs (see `createShareLink`). */
export const CANVAS_LINK_TOKEN_RE = /^[0-9a-f]{64}$/i;

/**
 * The board a caller may mint links for, or null.
 *
 * The route asks this rather than reading `creation_sessions` itself: a presentation
 * module that queries a table is a presentation module that will eventually apply its
 * own idea of who may share a board. Owner-gated, because minting a link is giving
 * access away to whoever it is forwarded to.
 *
 * Null for "no such board", "not yours" and "not the owner" alike — the route answers
 * 404 for all three so a board id cannot be probed for existence.
 */
export async function ownedCanvasSession(
  db: Db,
  input: { sessionId: string; tenantId: number; userId: string },
): Promise<SessionRef | null> {
  const access = await requireSessionRole(db, input.sessionId, input.tenantId, input.userId, 'owner');
  if (!access) return null;
  const [row] = await db
    .select({ id: creationSessions.id, tenantId: creationSessions.tenantId, title: creationSessions.title })
    .from(creationSessions)
    .where(scopedToTenant(creationSessions, input.tenantId, eq(creationSessions.id, input.sessionId)))
    .limit(1);
  return row ?? null;
}

export interface CanvasInviteLink {
  id: string;
  role: CanvasLinkRole;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

/** A minted link, with the raw token and the path to send — the only moment either exists. */
export interface MintedCanvasInviteLink extends CanvasInviteLink {
  token: string;
  joinPath: string;
}

const MAX_EXPIRY_HOURS = 24 * 90;

/**
 * Mint a link. `expiresInHours` and `maxUses` are the two dials that make a link
 * revocable BEFORE anybody has to remember to revoke it; both are optional, and a link
 * with neither is exactly the "anyone with this link" share the logged-out room already
 * offers.
 */
export async function mintCanvasInviteLink(
  db: Db,
  env: Env,
  input: {
    session: SessionRef;
    role: CanvasLinkRole;
    createdBy: string;
    expiresInHours?: number | null;
    maxUses?: number | null;
  },
): Promise<MintedCanvasInviteLink> {
  const object = await ensureSessionObject(db, env, input.session);
  const hours = input.expiresInHours == null ? null
    : Math.min(MAX_EXPIRY_HOURS, Math.max(1, Math.floor(input.expiresInHours)));
  const expiresAt = hours == null ? null : new Date(Date.now() + hours * 3_600_000);
  const maxUses = input.maxUses == null ? null : Math.max(1, Math.min(1_000, Math.floor(input.maxUses)));
  const share = await createShareLink(db, env, {
    tenantId: input.session.tenantId,
    objectId: object.id,
    scope: shareScopeForLinkRole(input.role),
    expiresAt,
    maxUses,
    createdBy: input.createdBy,
  });
  return {
    id: share.id,
    token: share.token,
    role: input.role,
    joinPath: canvasJoinPath(share.token),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    maxUses,
    useCount: 0,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * The live links for a board. The raw token is NOT here and cannot be — only its hash
 * was stored — which is why the mint response is the one chance to copy it, and why the
 * panel that lists them offers revoke-and-remint rather than "show the link again".
 */
export async function listCanvasInviteLinks(db: Db, env: Env, session: SessionRef): Promise<CanvasInviteLink[]> {
  const object = await findSessionObject(db, session);
  if (!object) return [];
  const shares = await getObjectShares(db, env, session.tenantId, object.id);
  return shares.map((share) => ({
    id: share.id,
    role: linkRoleForShareScope(share.scope),
    expiresAt: share.expiresAt ? new Date(share.expiresAt).toISOString() : null,
    maxUses: share.maxUses,
    useCount: share.useCount,
    lastUsedAt: share.lastUsedAt ? new Date(share.lastUsedAt).toISOString() : null,
    createdAt: new Date(share.createdAt).toISOString(),
  }));
}

/** Revoke one link. Ownership is proved by the link being ON this board's object, so a
 *  link id from another board cannot be revoked through this board's route. */
export async function revokeCanvasInviteLink(
  db: Db, env: Env, session: SessionRef, linkId: string,
): Promise<boolean> {
  const object = await findSessionObject(db, session);
  if (!object) return false;
  const shares = await getObjectShares(db, env, session.tenantId, object.id);
  if (!shares.some((share) => share.id === linkId)) return false;
  await revokeShareLink(db, env, session.tenantId, object.id, linkId);
  return true;
}

export interface CanvasInviteLinkTarget {
  sessionId: string;
  tenantId: number;
  title: string;
  role: CanvasLinkRole;
}

async function targetForToken(
  db: Db, env: Env, token: string, spendUse: boolean,
): Promise<CanvasInviteLinkTarget | null> {
  if (!CANVAS_LINK_TOKEN_RE.test(token)) return null;
  const resolved = spendUse ? await resolveShareToken(db, token) : await peekShareToken(db, token);
  if (!resolved) return null;
  const object = await getObject(db, env, resolved.tenantId, resolved.objectId);
  if (!object || object.kind !== 'creation_session') return null;
  const [session] = await db
    .select({ id: creationSessions.id, title: creationSessions.title, status: creationSessions.status })
    .from(creationSessions)
    .where(scopedToTenant(creationSessions, resolved.tenantId, eq(creationSessions.id, object.refId)))
    .limit(1);
  if (!session || session.status === 'deleted') return null;
  return {
    sessionId: session.id,
    tenantId: resolved.tenantId,
    title: session.title,
    role: linkRoleForShareScope(resolved.scope),
  };
}

/** What a link points at, WITHOUT spending one of its uses — the screen that has to
 *  describe the invitation before anybody decides whether to take it. */
export function previewCanvasInviteLink(db: Db, env: Env, token: string): Promise<CanvasInviteLinkTarget | null> {
  return targetForToken(db, env, token, false);
}

export type CanvasLinkClaimant =
  /** Somebody who is already signed in — a teammate, or a guest returning with the
   *  identity a previous claim gave them. */
  | { kind: 'user'; userId: string }
  /** Nobody yet. A guest identity is minted for them under the name they typed. */
  | { kind: 'guest'; displayName: string };

export type CanvasLinkClaim =
  | { ok: true; target: CanvasInviteLinkTarget; userId: string; guest: CanvasGuestIdentity | null; alreadyMember: boolean }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'capacity'; refusal: CollaboratorCapacityRefusal };

/**
 * Take a link: seat the claimant on the board and in the workspace, and say who they
 * turned out to be.
 *
 * The plan cap is checked BEFORE the share's use is spent, so a link refused for
 * capacity is still there when a seat frees up — a single-use link burned by a refusal
 * would be a share the owner has to notice and re-mint for a reason they never see.
 *
 * An existing member short-circuits everything: re-opening a link you have already
 * taken is how people return to a board, and it must not spend a use, add a row, or
 * count against a cap.
 */
export async function claimCanvasInviteLink(
  db: Db,
  env: Env,
  input: { token: string; claimant: CanvasLinkClaimant; collaboratorLimit: number },
): Promise<CanvasLinkClaim> {
  const target = await previewCanvasInviteLink(db, env, input.token);
  if (!target) return { ok: false, reason: 'invalid' };

  if (input.claimant.kind === 'user') {
    const [member] = await db
      .select({ userId: creationSessionMembers.userId })
      .from(creationSessionMembers)
      .where(and(
        eq(creationSessionMembers.sessionId, target.sessionId),
        eq(creationSessionMembers.userId, input.claimant.userId),
      ))
      .limit(1);
    if (member) {
      return { ok: true, target, userId: input.claimant.userId, guest: null, alreadyMember: true };
    }
  }

  const object = await findSessionObject(db, { id: target.sessionId, tenantId: target.tenantId, title: target.title });
  const refusal = await collaboratorCapacity(db, env, {
    tenantId: target.tenantId,
    sessionId: target.sessionId,
    objectId: object?.id ?? null,
    limit: input.collaboratorLimit,
    arrival: { alreadyMember: false },
  });
  if (refusal) return { ok: false, reason: 'capacity', refusal };

  // Spend the use only now that the claim is going to succeed.
  const spent = await targetForToken(db, env, input.token, true);
  if (!spent) return { ok: false, reason: 'invalid' };

  // `guest` is null on the signed-in path and that is the whole distinction: nothing
  // is MINTED for somebody who already has an identity, so there is nothing to hand
  // back a session for. The route reads it as "did this claim create a person".
  let guest: CanvasGuestIdentity | null = null;
  let userId: string;
  if (input.claimant.kind === 'user') {
    userId = input.claimant.userId;
  } else {
    guest = await createGuestUser(db, input.claimant.displayName);
    userId = guest.id;
  }

  await seatAsCollaborator(db, {
    tenantId: target.tenantId,
    userId,
    role: tenantRoleForSessionRole(target.role),
  });
  await db.insert(creationSessionMembers)
    .values({ sessionId: target.sessionId, userId, role: target.role })
    .onConflictDoNothing();

  return { ok: true, target, userId, guest, alreadyMember: false };
}
