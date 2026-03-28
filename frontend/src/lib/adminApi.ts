/**
 * Admin (superadmin) API client for api.builderforce.ai.
 * All requests use the Web JWT (not tenant token). Requires user.isSuperadmin and WebJWT with sa: true.
 */

import { getApiBaseUrl } from './apiClient';
import { checkUnauthorizedAndRedirect, getStoredWebToken } from './auth';

// ---------------------------------------------------------------------------
// Types (mirror api/admin routes)
// ---------------------------------------------------------------------------

export interface AdminUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  isSuperadmin: boolean;
  createdAt: string;
  tenantCount: number;
}

export interface AdminTenant {
  id: number;
  name: string;
  slug: string;
  status: string;
  plan: 'free' | 'pro';
  effectivePlan: 'free' | 'pro';
  billingStatus: string;
  billingEmail: string | null;
  billingUpdatedAt: string | null;
  isPaid: boolean;
  createdAt: string;
  memberCount: number;
  clawCount: number;
}

export interface AdminHealth {
  status: string;
  db: { ok: boolean; latencyMs: number };
  platform: {
    userCount: number;
    tenantCount: number;
    clawCount: number;
    executionCount: number;
    errorCount: number;
    paidTenantCount: number;
  };
  llm: {
    pool: number;
    models: Array<{
      model: string;
      preferred: boolean;
      available: boolean;
      cooldownUntil?: number;
    }>;
    free: Array<{
      model: string;
      preferred: boolean;
      available: boolean;
      cooldownUntil?: number;
    }>;
    pro: Array<{
      model: string;
      preferred: boolean;
      available: boolean;
      cooldownUntil?: number;
    }>;
  };
  timestamp: string;
}

export interface AdminError {
  id: number;
  method: string | null;
  path: string | null;
  message: string | null;
  stack: string | null;
  createdAt: string;
}

export interface LlmModelStat {
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  retries: number;
  streamed_requests: number;
}

export interface LlmDailyStat {
  day: string;
  requests: number;
  total_tokens: number;
}

export interface LlmFailoverStat {
  model: string;
  errorCode: number;
  count: number;
}

export interface LlmUsageStats {
  days: number;
  totals: {
    requests: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    modelCount: number;
  };
  byModel: LlmModelStat[];
  daily: LlmDailyStat[];
  failovers: LlmFailoverStat[];
}

export interface LegalDocument {
  documentType: 'terms' | 'privacy';
  version: string;
  title: string;
  content: string;
  publishedAt: string;
}

export interface AdminLegalCurrent {
  terms: LegalDocument;
  privacy: LegalDocument;
}

export interface AdminNewsletterSubscriber {
  id: number;
  userId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  source: string;
  status: 'subscribed' | 'unsubscribed' | 'suppressed';
  subscribedAt: string | null;
  unsubscribedAt: string | null;
  unsubscribeReason: string | null;
  lastCommunicationAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  userDisplayName?: string | null;
  userUsername?: string | null;
}

export interface AdminNewsletterTemplate {
  id: number;
  name: string;
  slug: string;
  subject: string;
  preheader: string | null;
  bodyMarkdown: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AdminNewsletterEvent {
  id: number;
  eventType: string;
  metadata: string | null;
  createdAt: string | null;
  subscriberId: number;
  email: string;
  templateId: number | null;
  templateName: string | null;
  templateSlug: string | null;
}

export interface AdminPrivacyRequest {
  id: number;
  userId: string | null;
  email: string;
  requestType: 'ccpa' | 'gdpr';
  status: 'pending' | 'completed' | 'closed';
  details: string | null;
  resolution: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
}

export interface AdminSecurityUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  activeSessions: number;
  activeTokens: number;
}

export interface AdminSecurityDetails {
  user: { id: string; email: string; username: string | null; displayName: string | null };
  mfa: {
    enabled: boolean;
    setupPending: boolean;
    enabledAt: string | null;
    recoveryGeneratedAt: string | null;
  };
  sessions: Array<{
    id: string;
    sessionName?: string | null;
    userAgent?: string | null;
    ipAddress?: string | null;
    isActive: boolean;
    revokedAt?: string | null;
    createdAt: string;
    lastSeenAt: string;
    activeTokens: number;
  }>;
  tokens: Array<{
    jti: string;
    tokenType: 'web' | 'tenant' | 'api' | 'claw';
    tenantId?: number | null;
    sessionId?: string | null;
    issuedAt: string;
    expiresAt: string;
    revokedAt?: string | null;
    userAgent?: string | null;
    ipAddress?: string | null;
    lastSeenAt: string;
    isActive: boolean;
  }>;
}

export interface AdminPlatformPersona {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  voice: string | null;
  perspective: string | null;
  decisionStyle: string | null;
  outputPrefix: string | null;
  capabilities: string[];
  tags: string[];
  source: string;
  author: string | null;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AdminProjectGovernance {
  id: number;
  name: string;
  tenantId: number;
  tenantName: string | null;
  governance: string | null;
  updatedAt: string | null;
}

export interface ImpersonationSession {
  id: string;
  adminUserId: string;
  targetUserId: string;
  targetEmail: string;
  targetDisplayName: string | null;
  tenantId: number;
  tenantName: string;
  roleOverride: string;
  reason: string;
  tokenJti: string | null;
  startedAt: string;
  endedAt: string | null;
  expiresAt: string;
  endReason: string | null;
  pagesVisited: string[];
  writeBlockCount: number;
  debuggerEnabled: boolean;
}

export interface ImpersonationStartResult {
  session: ImpersonationSession;
  emulationToken: string;
}

export interface ImpersonationRoleSwitch {
  id: string;
  sessionId: string;
  fromRole: string;
  toRole: string;
  switchedAt: string;
}

export interface AuditLogEntry {
  id: string;
  event: string;
  actorId: string | null;
  actorEmail: string | null;
  targetUserId: string | null;
  targetEmail: string | null;
  tenantId: number | null;
  tenantName: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface PermissionRegistryEntry {
  permission: string;
  description?: string | null;
}

export interface PermissionMatrix {
  roles: string[];
  permissions: string[];
  matrix: Record<string, string[]>;
  overrides: Array<{
    tenantId: number | null;
    role: string;
    permission: string;
    granted: boolean;
  }>;
}

export interface PlatformModule {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  defaultEnabled: boolean;
  permissions: string[];
  createdAt: string;
}

export interface UserWorkspace {
  tenantId: number;
  name: string;
  slug: string;
  role: string;
  joinedAt: string | null;
}

export interface TenantMember {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  role: string;
  isActive: boolean;
  joinedAt: string;
}

export interface EffectivePermissions {
  userId: string;
  tenantId: number;
  role: string;
  permissions: string[];
  rolePermissions: string[];
  modulePermissions: string[];
  userGrants: string[];
  userRevocations: string[];
}

// ---------------------------------------------------------------------------
// Request helper — uses Web token only
// ---------------------------------------------------------------------------

async function adminRequest<T>(
  path: string,
  opts: RequestInit & { body?: string } = {}
): Promise<T> {
  const webToken = getStoredWebToken();
  if (!webToken) throw new Error('Not authenticated. Sign in with a superadmin account.');
  const hadToken = true;
  const { body, ...init } = opts;
  const url = `${getApiBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${webToken}`,
      ...(init.headers as Record<string, string>),
    },
    ...(body !== undefined && { body }),
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(msg.error || res.statusText || `Admin request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

export const adminApi = {
  async users(): Promise<AdminUser[]> {
    const res = await adminRequest<{ users: AdminUser[] }>('/api/admin/users');
    return res.users;
  },

  async tenants(): Promise<AdminTenant[]> {
    const res = await adminRequest<{ tenants: AdminTenant[] }>('/api/admin/tenants');
    return res.tenants;
  },

  async tenantMembers(tenantId: number): Promise<TenantMember[]> {
    const res = await adminRequest<{ members: TenantMember[] }>(`/api/admin/tenants/${tenantId}/members`);
    return res.members;
  },

  async health(): Promise<AdminHealth> {
    return adminRequest<AdminHealth>('/api/admin/health');
  },

  async errors(): Promise<AdminError[]> {
    const res = await adminRequest<{ errors: AdminError[] }>('/api/admin/errors');
    return res.errors;
  },

  async impersonate(userId: string, tenantId: number): Promise<{
    token: string;
    email: string;
    tenantId: number;
    role: string;
    expiresIn?: number;
  }> {
    return adminRequest('/api/admin/impersonate', {
      method: 'POST',
      body: JSON.stringify({ userId, tenantId }),
    });
  },

  async llmUsage(days = 30): Promise<LlmUsageStats> {
    return adminRequest<LlmUsageStats>(`/api/admin/llm-usage?days=${days}`);
  },

  // Legal
  async legalCurrent(): Promise<AdminLegalCurrent> {
    return adminRequest<AdminLegalCurrent>('/api/admin/legal/current');
  },
  async publishTerms(data: { version: string; title?: string; content: string }): Promise<{ terms: LegalDocument }> {
    return adminRequest('/api/admin/legal/terms/publish', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Newsletter
  async newsletterSubscribers(params?: {
    status?: 'subscribed' | 'unsubscribed' | 'suppressed';
    q?: string;
    limit?: number;
  }): Promise<AdminNewsletterSubscriber[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.q) query.set('q', params.q);
    if (params?.limit) query.set('limit', String(params.limit));
    const suffix = query.toString();
    const res = await adminRequest<{ subscribers: AdminNewsletterSubscriber[] }>(
      `/api/admin/newsletter/subscribers${suffix ? `?${suffix}` : ''}`
    );
    return res.subscribers;
  },
  async newsletterTemplates(): Promise<AdminNewsletterTemplate[]> {
    const res = await adminRequest<{ templates: AdminNewsletterTemplate[] }>('/api/admin/newsletter/templates');
    return res.templates;
  },
  async createNewsletterTemplate(data: {
    name: string;
    slug?: string;
    subject: string;
    preheader?: string;
    bodyMarkdown: string;
    isActive?: boolean;
  }): Promise<{ template: AdminNewsletterTemplate }> {
    return adminRequest('/api/admin/newsletter/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  async updateNewsletterTemplate(
    id: number,
    data: Partial<Pick<AdminNewsletterTemplate, 'name' | 'slug' | 'subject' | 'preheader' | 'bodyMarkdown' | 'isActive'>>
  ): Promise<{ template: AdminNewsletterTemplate }> {
    return adminRequest(`/api/admin/newsletter/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  async newsletterEvents(limit = 300): Promise<AdminNewsletterEvent[]> {
    const res = await adminRequest<{ events: AdminNewsletterEvent[] }>(
      `/api/admin/newsletter/events?limit=${Math.min(limit, 1000)}`
    );
    return res.events;
  },
  async trackNewsletterEvent(data: {
    subscriberEmail: string;
    templateId?: number | null;
    eventType: 'template_sent' | 'email_opened' | 'email_clicked';
    metadata?: string;
  }): Promise<{ ok: boolean }> {
    return adminRequest('/api/admin/newsletter/events', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Privacy
  async privacyRequests(params?: {
    status?: string;
    type?: string;
    q?: string;
    limit?: number;
  }): Promise<AdminPrivacyRequest[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.type) query.set('type', params.type);
    if (params?.q) query.set('q', params.q);
    if (params?.limit) query.set('limit', String(params.limit));
    const suffix = query.toString();
    const res = await adminRequest<{ requests: AdminPrivacyRequest[] }>(
      `/api/admin/privacy-requests${suffix ? `?${suffix}` : ''}`
    );
    return res.requests;
  },
  async updatePrivacyRequest(
    id: number,
    data: { status?: string; resolution?: string | null }
  ): Promise<{ request: AdminPrivacyRequest }> {
    return adminRequest(`/api/admin/privacy-requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Security
  async securityUsers(tenantId: number): Promise<AdminSecurityUser[]> {
    const res = await adminRequest<{ users: AdminSecurityUser[] }>(
      `/api/admin/security/users?tenantId=${tenantId}`
    );
    return res.users;
  },
  async securityDetails(tenantId: number, userId: string): Promise<AdminSecurityDetails> {
    return adminRequest<AdminSecurityDetails>(
      `/api/admin/security/users/${encodeURIComponent(userId)}?tenantId=${tenantId}`
    );
  },
  async securityMfaSetup(tenantId: number, userId: string): Promise<{
    otpauthUrl: string;
    manualEntryKey: string;
    expiresIn: number;
  }> {
    return adminRequest(`/api/admin/security/users/${encodeURIComponent(userId)}/mfa/setup?tenantId=${tenantId}`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  async securityMfaEnable(
    tenantId: number,
    userId: string,
    code: string
  ): Promise<{ enabled: boolean; recoveryCodes: string[] }> {
    return adminRequest(
      `/api/admin/security/users/${encodeURIComponent(userId)}/mfa/enable?tenantId=${tenantId}`,
      { method: 'POST', body: JSON.stringify({ code }) }
    );
  },
  async securityMfaDisable(
    tenantId: number,
    userId: string,
    data: { code?: string; recoveryCode?: string }
  ): Promise<{ enabled: boolean }> {
    return adminRequest(
      `/api/admin/security/users/${encodeURIComponent(userId)}/mfa/disable?tenantId=${tenantId}`,
      { method: 'POST', body: JSON.stringify(data) }
    );
  },
  async securityRegenerateRecoveryCodes(
    tenantId: number,
    userId: string,
    data: { code?: string; recoveryCode?: string }
  ): Promise<{ recoveryCodes: string[] }> {
    return adminRequest(
      `/api/admin/security/users/${encodeURIComponent(userId)}/mfa/recovery-codes/regenerate?tenantId=${tenantId}`,
      { method: 'POST', body: JSON.stringify(data) }
    );
  },
  async securityRevokeSession(
    tenantId: number,
    userId: string,
    sessionId: string
  ): Promise<void> {
    return adminRequest(
      `/api/admin/security/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/revoke?tenantId=${tenantId}`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  },
  async securityRevokeAllSessions(tenantId: number, userId: string): Promise<void> {
    return adminRequest(
      `/api/admin/security/users/${encodeURIComponent(userId)}/sessions/revoke-all?tenantId=${tenantId}`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  },
  async securityRevokeToken(
    tenantId: number,
    userId: string,
    jti: string
  ): Promise<void> {
    return adminRequest(
      `/api/admin/security/users/${encodeURIComponent(userId)}/tokens/${encodeURIComponent(jti)}/revoke?tenantId=${tenantId}`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  },

  // Platform personas (admin CRUD)
  async personas(): Promise<AdminPlatformPersona[]> {
    const res = await adminRequest<{ personas: AdminPlatformPersona[] }>('/api/admin/personas');
    return res.personas;
  },
  async createPersona(data: {
    name: string;
    slug?: string;
    description?: string | null;
    voice?: string | null;
    perspective?: string | null;
    decisionStyle?: string | null;
    outputPrefix?: string | null;
    capabilities?: string[];
    tags?: string[];
    source?: string;
    author?: string | null;
    active?: boolean;
  }): Promise<{ persona: AdminPlatformPersona }> {
    return adminRequest('/api/admin/personas', { method: 'POST', body: JSON.stringify(data) });
  },
  async updatePersona(
    id: number,
    data: Partial<{
      name: string;
      slug: string;
      description: string | null;
      voice: string | null;
      perspective: string | null;
      decisionStyle: string | null;
      outputPrefix: string | null;
      capabilities: string[];
      tags: string[];
      source: string;
      author: string | null;
      active: boolean;
    }>
  ): Promise<{ persona: AdminPlatformPersona }> {
    return adminRequest(`/api/admin/personas/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  async deletePersona(id: number): Promise<void> {
    await adminRequest(`/api/admin/personas/${id}`, { method: 'DELETE' });
  },

  // Admin projects (Governance tab — list all, update governance)
  async adminProjects(): Promise<AdminProjectGovernance[]> {
    const res = await adminRequest<{ projects: AdminProjectGovernance[] }>('/api/admin/projects');
    return res.projects;
  },
  async updateProjectGovernance(projectId: number, governance: string | null): Promise<{ project: { id: number; name: string; governance: string | null } }> {
    return adminRequest(`/api/admin/projects/${projectId}/governance`, {
      method: 'PATCH',
      body: JSON.stringify({ governance }),
    });
  },

  async userWorkspaces(userId: string): Promise<UserWorkspace[]> {
    const res = await adminRequest<{ workspaces: UserWorkspace[] }>(`/api/admin/users/${encodeURIComponent(userId)}/workspaces`);
    return res.workspaces;
  },

  // Impersonation
  async impersonationStart(
    userId: string,
    tenantId: number,
    reason: string,
    debuggerEnabled = false,
  ): Promise<ImpersonationStartResult> {
    return adminRequest('/api/admin/impersonation/start', {
      method: 'POST',
      body: JSON.stringify({ userId, tenantId, reason, debuggerEnabled }),
    });
  },

  async impersonationEnd(sessionId: string): Promise<void> {
    return adminRequest(`/api/admin/impersonation/${encodeURIComponent(sessionId)}/end`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async impersonationSwitchRole(
    sessionId: string,
    newRole: string,
  ): Promise<{ emulationToken: string; session: ImpersonationSession }> {
    return adminRequest(`/api/admin/impersonation/${encodeURIComponent(sessionId)}/switch-role`, {
      method: 'POST',
      body: JSON.stringify({ newRole }),
    });
  },

  async impersonationActive(): Promise<ImpersonationSession | null> {
    const res = await adminRequest<{ session: ImpersonationSession | null }>('/api/admin/impersonation/active');
    return res.session;
  },

  async impersonationList(params?: {
    limit?: number;
    offset?: number;
  }): Promise<{ sessions: ImpersonationSession[]; total: number }> {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    const suffix = q.toString();
    return adminRequest(`/api/admin/impersonation${suffix ? `?${suffix}` : ''}`);
  },

  async impersonationDetail(sessionId: string): Promise<{
    session: ImpersonationSession;
    roleSwitches: ImpersonationRoleSwitch[];
  }> {
    return adminRequest(`/api/admin/impersonation/${encodeURIComponent(sessionId)}`);
  },

  // Permissions
  async permissionsRegistry(): Promise<PermissionRegistryEntry[]> {
    const res = await adminRequest<{ permissions: PermissionRegistryEntry[] }>('/api/admin/permissions');
    return res.permissions;
  },

  async permissionsMatrix(): Promise<PermissionMatrix> {
    return adminRequest<PermissionMatrix>('/api/admin/permissions/matrix');
  },

  async updateRolePermissions(
    role: string,
    overrides: Array<{ permission: string; granted: boolean }>,
    tenantId?: number,
  ): Promise<void> {
    await adminRequest(`/api/admin/permissions/roles/${encodeURIComponent(role)}`, {
      method: 'PUT',
      body: JSON.stringify({ overrides, tenantId }),
    });
  },

  async permissionsMatrixExport(): Promise<string> {
    const webToken = getStoredWebToken();
    if (!webToken) throw new Error('Not authenticated.');
    const res = await fetch(`${getApiBaseUrl()}/api/admin/permissions/matrix/export`, {
      headers: { Authorization: `Bearer ${webToken}` },
    });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.text();
  },

  // Modules
  async modules(): Promise<PlatformModule[]> {
    const res = await adminRequest<{ modules: PlatformModule[] }>('/api/admin/modules');
    return res.modules;
  },

  async createModule(data: {
    name: string;
    slug?: string;
    description?: string | null;
    defaultEnabled?: boolean;
    permissions?: string[];
  }): Promise<{ module: PlatformModule }> {
    return adminRequest('/api/admin/modules', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateModule(
    id: number,
    data: Partial<Pick<PlatformModule, 'name' | 'description' | 'defaultEnabled' | 'permissions'>>,
  ): Promise<{ module: PlatformModule }> {
    return adminRequest(`/api/admin/modules/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async deleteModule(id: number): Promise<void> {
    await adminRequest(`/api/admin/modules/${id}`, { method: 'DELETE' });
  },

  async assignMemberModule(tenantId: number, userId: string, moduleId: number): Promise<void> {
    await adminRequest(
      `/api/admin/tenants/${tenantId}/members/${encodeURIComponent(userId)}/modules`,
      { method: 'POST', body: JSON.stringify({ moduleId }) },
    );
  },

  async removeMemberModule(tenantId: number, userId: string, moduleId: number): Promise<void> {
    await adminRequest(
      `/api/admin/tenants/${tenantId}/members/${encodeURIComponent(userId)}/modules/${moduleId}`,
      { method: 'DELETE' },
    );
  },

  // User management
  async forceLogout(userId: string): Promise<void> {
    await adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/force-logout`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async resetPassword(userId: string): Promise<void> {
    await adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async setUserStatus(userId: string, suspended: boolean): Promise<void> {
    await adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ suspended }),
    });
  },

  async updateUserPermissions(
    userId: string,
    data: { grants: string[]; revocations: string[]; tenantId?: number },
  ): Promise<void> {
    await adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/permissions`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async overrideMemberRole(tenantId: number, userId: string, role: string): Promise<void> {
    await adminRequest(
      `/api/admin/tenants/${tenantId}/members/${encodeURIComponent(userId)}/role`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    );
  },

  async effectivePermissions(userId: string, tenantId: number): Promise<EffectivePermissions> {
    return adminRequest<EffectivePermissions>(
      `/api/admin/users/${encodeURIComponent(userId)}/effective-permissions?tenantId=${tenantId}`,
    );
  },

  async userAdminAccess(userId: string): Promise<{ sessions: ImpersonationSession[] }> {
    return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/admin-access`);
  },

  async auditLog(params?: {
    event?: string;
    actorId?: string;
    targetUserId?: string;
    tenantId?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: AuditLogEntry[]; total: number }> {
    const q = new URLSearchParams();
    if (params?.event) q.set('event', params.event);
    if (params?.actorId) q.set('actorId', params.actorId);
    if (params?.targetUserId) q.set('targetUserId', params.targetUserId);
    if (params?.tenantId) q.set('tenantId', String(params.tenantId));
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    const suffix = q.toString();
    return adminRequest(`/api/admin/audit-log${suffix ? `?${suffix}` : ''}`);
  },

  async auditLogExport(params?: {
    event?: string;
    actorId?: string;
    targetUserId?: string;
    tenantId?: number;
  }): Promise<string> {
    const webToken = getStoredWebToken();
    if (!webToken) throw new Error('Not authenticated.');
    const q = new URLSearchParams();
    if (params?.event) q.set('event', params.event);
    if (params?.actorId) q.set('actorId', params.actorId);
    if (params?.targetUserId) q.set('targetUserId', params.targetUserId);
    if (params?.tenantId) q.set('tenantId', String(params.tenantId));
    const suffix = q.toString();
    const res = await fetch(
      `${getApiBaseUrl()}/api/admin/audit-log/export${suffix ? `?${suffix}` : ''}`,
      { headers: { Authorization: `Bearer ${webToken}` } },
    );
    if (!res.ok) throw new Error(`Audit log export failed (${res.status})`);
    return res.text();
  },
};
