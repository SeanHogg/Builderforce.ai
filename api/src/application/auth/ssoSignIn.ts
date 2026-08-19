/**
 * What happens to an SSO identity AFTER the provider vouches for it.
 *
 * Split from `enterpriseSso.ts` (which owns the protocol) and from the route
 * (which owns HTTP) because this is the part that writes: resolve or provision
 * the account, bind it to the provider's subject, and put the person in the
 * workspace whose connection authenticated them. A route that did this inline
 * would be a presentation file holding the account-creation rules for an entire
 * authentication method.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { oauthAccounts, tenantMembers, users } from '../../infrastructure/database/schema';
import { ensureStarterWorkspace } from '../tenant/starterWorkspace';
import type { Env } from '../../env';
import type { SsoIdentity } from './enterpriseSso';

/**
 * `oauth_accounts.provider` for an SSO identity.
 *
 * One fixed value with the CONNECTION ID inside the account id, not a
 * per-connection provider string: the column is varchar(50), and
 * `uq_oauth_provider_account` then still keeps two institutions' identically
 * numbered subjects apart. `sub` is unique per issuer, not globally.
 */
const SSO_PROVIDER = 'sso';

const ssoAccountId = (connectionId: number, subject: string): string =>
  `${connectionId}|${subject}`.slice(0, 255);

/** The four roles `tenant_role` declares. A connection's `defaultRole` is
 *  operator-typed, so it is validated against the enum rather than cast into it —
 *  an invalid value would otherwise fail at INSERT time, mid-login. */
const TENANT_ROLES = ['owner', 'manager', 'developer', 'viewer'] as const;
type TenantRoleValue = typeof TENANT_ROLES[number];

const asTenantRole = (value: string): TenantRoleValue =>
  (TENANT_ROLES as readonly string[]).includes(value) ? value as TenantRoleValue : 'developer';

export type SsoSignInResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

/**
 * Turn a verified SSO identity into a signed-in user.
 *
 * Order is the same as the OAuth callback's, and for the same reason: the
 * external BINDING is authoritative, the email is only a linking hint, and
 * creation is last. Matching on email first would let a provider that reused an
 * address take over an existing account.
 */
export async function signInWithSso(
  env: Env,
  db: Db,
  identity: SsoIdentity,
): Promise<SsoSignInResult> {
  const connection = identity.connection;
  const accountId = ssoAccountId(connection.id, identity.subject);

  const [bound] = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, SSO_PROVIDER), eq(oauthAccounts.providerAccountId, accountId)))
    .limit(1);

  let userId = bound?.userId ?? '';
  if (!userId) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, identity.email)).limit(1);
    userId = existing?.id ?? '';

    if (!userId) {
      // The connection's own switch, and it is not overridable by a successful
      // login: an institution that provisions seats by hand is asking us to
      // refuse people their IdP authenticates, which is a strange-sounding
      // requirement and a real one.
      if (!connection.jitProvisioning) return { ok: false, error: 'sso_account_not_provisioned' };
      userId = crypto.randomUUID();
      await db.insert(users).values({
        id: userId,
        email: identity.email,
        username: await uniqueUsername(db, identity.email),
        displayName: identity.name,
        passwordHash: null,
        apiKeyHash: null,
        // The institution's IdP vouched for the address — exactly what OAuth
        // vouching is — so the account skips the signup OTP gate.
        emailVerifiedAt: new Date(),
      });
      await ensureStarterWorkspace(env, db, {
        id: userId,
        email: identity.email,
        username: identity.email.split('@')[0] ?? identity.email,
        displayName: identity.name,
      });
    }

    await db.insert(oauthAccounts).values({
      userId,
      provider: SSO_PROVIDER,
      providerAccountId: accountId,
      email: identity.email,
      displayName: identity.name,
    }).onConflictDoNothing({ target: [oauthAccounts.provider, oauthAccounts.providerAccountId] });
  }

  // Membership in the workspace that owns the connection, at the role IT
  // declared. Checked on EVERY sign-in rather than only at account creation: an
  // administrator who connects a domain expects the accounts that already exist
  // on it to arrive in their workspace, not only ones created afterwards.
  const [member] = await db
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, connection.tenantId), eq(tenantMembers.userId, userId)))
    .limit(1);
  if (!member) {
    await db.insert(tenantMembers).values({
      tenantId: connection.tenantId,
      userId,
      role: asTenantRole(connection.defaultRole),
    });
  }

  const [user] = await db
    .select({ id: users.id, isSuspended: users.isSuspended })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { ok: false, error: 'sso_account_not_found' };
  if (user.isSuspended) return { ok: false, error: 'account_suspended' };

  return { ok: true, userId };
}

/** Same alphabet and same fallback as the OAuth callback's generator — two
 *  account-creation paths producing differently-shaped handles makes the
 *  username look arbitrary to the person who has to live with it. */
async function uniqueUsername(db: Db, email: string): Promise<string> {
  const base = email.split('@')[0]!.replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 20);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 16)}_${crypto.randomUUID().slice(0, 4)}`;
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, candidate)).limit(1);
    if (!taken) return candidate;
  }
  return `user_${crypto.randomUUID().slice(0, 8)}`;
}
