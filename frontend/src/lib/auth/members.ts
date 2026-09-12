/**
 * The workspace roster — members, their roles, and pending invitations.
 *
 * On `apiRequest` with the workspace (`tenant`) credential, like every other
 * workspace read. These were hand-written `fetch`es under the login exemption,
 * and so they never sent `X-Emulation-Token`: a superadmin emulating a tenant
 * opened the roster and was shown their OWN members.
 *
 * The header alone does not fix that. Every one of these routes refuses a
 * `:tenantId` that is not the caller's (`tenantRoutes` → 403), and during an
 * emulation the caller IS the emulated workspace — so the path has to name it.
 * {@link rosterPath} resolves the id once, from the same token the header
 * carries, rather than asking every screen to know it is being emulated.
 */

import { apiRequest, emulatedTenantId } from '../apiClient';

/** Member row returned by GET /api/tenants/:id/security/users. */
export interface TenantMember {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  /** Workspace role: owner | manager | developer | viewer. */
  role: string;
  joinedAt: string | null;
  activeSessions: number;
  activeTokens: number;
  /** This person's personality (parsed); null when they haven't taken the test. */
  psychometric?: import('../psychometric').PsychometricProfile | null;
}

/** A pending (not-yet-accepted) workspace invitation. */
export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

/**
 * Outcome of an invite: `added` when the email already had an account (now a
 * member), `pending` when it didn't (a pending invite was recorded and will
 * auto-accept when they sign up).
 */
export type InviteResult = { status: 'added' | 'pending'; email: string };

/** `/api/tenants/:id…` for the workspace this request actually acts as. */
function rosterPath(tenantId: string, rest: string): string {
  return `/api/tenants/${encodeURIComponent(emulatedTenantId() ?? tenantId)}${rest}`;
}

/**
 * Drop the shell's held team roster after a membership write — the client half of
 * the api's `membershipChanged`. Dynamically imported so this data module does
 * not pull the React hook module into every importer. Best-effort: a roster that
 * cannot be refreshed self-heals on the next mount.
 */
async function refreshTeamRoster(): Promise<void> {
  try {
    const { invalidateTeamRoster } = await import('../team/useTeamRoster');
    invalidateTeamRoster();
  } catch {
    // no-op — see above.
  }
}

export const membersApi = {
  /** Every active member of the workspace. Requires the manager role. */
  async list(tenantId: string): Promise<TenantMember[]> {
    const data = await apiRequest<{ users?: TenantMember[] }>(rosterPath(tenantId, '/security/users'));
    return data?.users ?? [];
  },

  /** Remove a member. Requires the manager role. */
  async remove(tenantId: string, userId: string): Promise<void> {
    await apiRequest(rosterPath(tenantId, `/members/${encodeURIComponent(userId)}`), { method: 'DELETE', raw: true });
    await refreshTeamRoster();
  },

  /** Change a member's role. Requires manager (owner to touch owners). */
  async updateRole(tenantId: string, userId: string, role: string): Promise<void> {
    await apiRequest(rosterPath(tenantId, `/members/${encodeURIComponent(userId)}/role`), {
      method: 'PATCH', body: JSON.stringify({ role }), raw: true,
    });
    await refreshTeamRoster();
  },

  /** Invite a person by email. */
  async inviteByEmail(tenantId: string, email: string, role: string = 'developer'): Promise<InviteResult> {
    const body = await apiRequest<{ status?: 'added' | 'pending' }>(rosterPath(tenantId, '/invite-by-email'), {
      method: 'POST', body: JSON.stringify({ email, role }),
    });
    const status = body?.status ?? 'added';
    // 'added' means the invitee already had an account and is a member NOW — the
    // footer roster is stale the instant this resolves.
    if (status === 'added') await refreshTeamRoster();
    return { status, email: email.toLowerCase().trim() };
  },

  /** The workspace's pending invitations. Requires the manager role. */
  async listInvitations(tenantId: string): Promise<PendingInvitation[]> {
    const data = await apiRequest<{ invitations?: PendingInvitation[] }>(rosterPath(tenantId, '/invitations'));
    return data?.invitations ?? [];
  },

  /** Revoke a pending invitation. Requires the manager role. */
  async revokeInvitation(tenantId: string, invitationId: string): Promise<void> {
    await apiRequest(rosterPath(tenantId, `/invitations/${encodeURIComponent(invitationId)}`), { method: 'DELETE', raw: true });
  },
};
