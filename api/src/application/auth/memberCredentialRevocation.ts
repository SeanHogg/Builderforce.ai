/**
 * Revoking a workspace member's sign-in credentials — one session, one token,
 * or all of them — as an act of a workspace MANAGER or of a platform superadmin.
 *
 * The workspace security page (`/api/tenants/:id/security/users/...`) and the
 * superadmin console (`/api/admin/security/users/...?tenantId=`) each carried
 * three identical handlers for this. What differs between them is only HOW the
 * workspace is established and authorized (the caller's own workspace behind a
 * manager role, vs. any workspace behind the superadmin gate); that stays in the
 * route adapters. The act itself — "only an active member of that workspace,
 * revoked through the one revocation path" — is this.
 *
 * The credential tables are not tenant-owned (see `session_credential` in
 * `tenantScope.ts`); `tenantId` narrows the revoke to tokens minted under this
 * workspace, it is not the gate. The gate is the membership check below plus the
 * caller's route-level authorization.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tenantRoleOf } from '../tenant/tenantRoles';
import { revokeSessionTokens } from './sessionRevocation';

/** Which of the member's credentials to revoke. */
export type MemberCredential = { sessionId: string } | { jti: string } | { all: true };

export type MemberCredentialRevocation = { ok: true } | { ok: false; reason: 'not_member' };

export async function revokeMemberCredentials(
  db: Db,
  env: Env | undefined,
  input: { tenantId: number; userId: string; credential: MemberCredential },
): Promise<MemberCredentialRevocation> {
  const { tenantId, userId, credential } = input;
  // A manager can only reach people in their own workspace, and a superadmin's
  // `?tenantId=` must actually name one of the person's workspaces.
  if ((await tenantRoleOf(db, tenantId, userId)) === null) return { ok: false, reason: 'not_member' };
  const narrowing = 'sessionId' in credential ? { sessionId: credential.sessionId }
    : 'jti' in credential ? { jti: credential.jti }
      : {};
  await revokeSessionTokens(db, env, { userId, tenantId, ...narrowing });
  return { ok: true };
}
