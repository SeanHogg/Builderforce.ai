/**
 * The signed-in person's OWN account sessions: where they are signed in (and
 * revoking those sessions), plus the read-only log of platform-admin access to their
 * account. Person-level, so every call carries the web JWT (`auth: 'web'`), not the
 * workspace token.
 */
import { apiRequest } from './apiClient';

// ---------------------------------------------------------------------------
// Self-service session management
// ---------------------------------------------------------------------------

export interface MySession {
  id: string;
  sessionName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  isActive: boolean;
  isCurrent: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export const mySessionsApi = {
  list: (): Promise<MySession[]> =>
    apiRequest<{ sessions: MySession[] }>('/api/auth/sessions', { auth: 'web' }).then((r) => r.sessions ?? []),

  revoke: (sessionId: string): Promise<void> =>
    apiRequest(`/api/auth/sessions/${sessionId}/revoke`, { method: 'POST', auth: 'web' }).then(() => undefined),

  revokeOthers: (): Promise<void> =>
    apiRequest('/api/auth/sessions/revoke-others', { method: 'POST', auth: 'web' }).then(() => undefined),
};

// ---------------------------------------------------------------------------
// My admin access log (impersonation sessions targeting the current user)
// ---------------------------------------------------------------------------

export interface MyAdminAccessSession {
  id: string;
  adminUserId: string;
  tenantId: number;
  tenantName: string;
  roleOverride: string;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  pagesVisited: string[];
  writeBlockCount: number;
}

export const myAdminAccessApi = {
  list: (): Promise<MyAdminAccessSession[]> =>
    apiRequest<{ sessions: MyAdminAccessSession[] }>('/api/auth/me/admin-access', { auth: 'web' }).then((r) => r.sessions ?? []),
};
