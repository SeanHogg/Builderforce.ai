/**
 * STARTING an impersonation session (PRD §4.2) — the ONE way a superadmin gets a
 * token that acts as somebody else.
 *
 * There used to be two doors. `POST /api/admin/impersonation/start` did it properly:
 * a recorded session with a reason, one active session per admin, never a superadmin
 * target, a role capped at the target's own (impersonationRole.ts), a read-only
 * emulation token whose JTI is stored for revocation, and an `IMPERSONATION_STARTED`
 * audit row. `POST /api/admin/impersonate` predated all of that and signed an ordinary,
 * WRITABLE one-hour tenant JWT for any user+tenant pair — no session to end, no audit
 * row, superadmins included — which is the gap the PRD was written to close. Both
 * routes now call {@link startImpersonation}; the old path survives only as a
 * deprecated adapter (see adminRoutes.ts), so the governance cannot be bypassed by
 * picking the older URL.
 */

import { eq, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { adminImpersonationSessions, tenants, users } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { decodeJwtPayload, signEmulationJwt } from '../../infrastructure/auth/JwtService';
import { writeAdminAudit } from '../../infrastructure/audit/adminAudit';
import { InternalError } from '../../domain/shared/errors';
import type { TenantRole } from '../../domain/shared/types';
import { resolveImpersonationRole } from './impersonationRole';

/** A session (and its token) lives one hour. */
export const IMPERSONATION_TTL_SECONDS = 3600;

export interface StartImpersonationInput {
  adminId: string;
  userId: string;
  tenantId: number;
  /** Requested role; absent ⇒ the target's own (capped either way). */
  role?: string | null;
  /** Why — stored on the session and the audit row. Required, never blank. */
  reason: string;
  enableDebugger?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface StartedImpersonation {
  sessionId: string;
  token: string;
  user: { id: string; email: string; displayName: string | null; avatarUrl: string | null };
  tenant: { id: number; name: string; slug: string };
  role: TenantRole;
  startedAt: string;
  expiresAt: string;
  debugger: boolean;
}

export type StartImpersonationResult =
  | { ok: true; started: StartedImpersonation }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string; sessionId?: string };

export async function startImpersonation(
  env: { JWT_SECRET: string },
  db: Db,
  input: StartImpersonationInput,
): Promise<StartImpersonationResult> {
  const reason = input.reason.trim();
  if (!input.userId || !input.tenantId || !reason) {
    return { ok: false, status: 400, error: 'userId, tenantId, and reason are required' };
  }

  // Never a Super Admin: impersonating one is acting with platform authority.
  const [target] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName, avatarUrl: users.avatarUrl, isSuperadmin: users.isSuperadmin })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!target) return { ok: false, status: 404, error: 'User not found' };
  if (target.isSuperadmin) return { ok: false, status: 403, error: 'Cannot impersonate a Super Admin account' };

  // One active session at a time, so "end impersonation" always has one answer.
  const [existing] = await db
    .select({ id: adminImpersonationSessions.id })
    .from(adminImpersonationSessions)
    .where(scopedToTenant(adminImpersonationSessions, input.tenantId,
      eq(adminImpersonationSessions.adminUserId, input.adminId),
      isNull(adminImpersonationSessions.endedAt)))
    .limit(1);
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: 'You already have an active impersonation session. End it before starting a new one.',
      sessionId: existing.id,
    };
  }

  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  if (!tenant) return { ok: false, status: 404, error: 'Tenant not found' };

  // A known role, never above the target's own (impersonationRole.ts).
  const roleDecision = await resolveImpersonationRole(db, input.tenantId, input.userId, input.role ?? undefined);
  if (!roleDecision.ok) return { ok: false, status: roleDecision.status, error: roleDecision.error };
  const role = roleDecision.role;
  const debuggerEnabled = input.enableDebugger ?? false;
  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_SECONDS * 1000);

  const [session] = await db
    .insert(adminImpersonationSessions)
    .values({
      adminUserId:     input.adminId,
      targetUserId:    input.userId,
      tenantId:        input.tenantId,
      roleOverride:    role,
      reason,
      expiresAt,
      ipAddress:       input.ipAddress ?? null,
      userAgent:       input.userAgent ?? null,
      debuggerEnabled,
    })
    .returning();
  if (!session) throw new InternalError('Failed to create impersonation session');

  const token = await signEmulationJwt(
    { sub: input.userId, tid: input.tenantId, role, emuBy: input.adminId, emuSid: session.id },
    env.JWT_SECRET,
  );

  // The JTI goes back on the session so ending it can revoke the token immediately.
  const { jti } = decodeJwtPayload<{ jti?: string }>(token);
  if (jti) {
    await db
      .update(adminImpersonationSessions)
      .set({ tokenJti: jti })
      .where(scopedToTenant(adminImpersonationSessions, input.tenantId, eq(adminImpersonationSessions.id, session.id)));
  }

  await writeAdminAudit(db, 'IMPERSONATION_STARTED', input.adminId, {
    targetUserId: input.userId,
    tenantId:     input.tenantId,
    metadata:     { sessionId: session.id, role, reason, debugger: debuggerEnabled },
    ipAddress:    input.ipAddress ?? null,
  });

  return {
    ok: true,
    started: {
      sessionId: session.id,
      token,
      user: { id: target.id, email: target.email, displayName: target.displayName, avatarUrl: target.avatarUrl },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      role,
      startedAt: session.startedAt?.toISOString() ?? new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      debugger: debuggerEnabled,
    },
  };
}
