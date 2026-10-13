import { apiRequest } from './apiClient';

/**
 * THE billing client — the workspace's subscription, read and changed.
 *
 * It exists because `/pricing` was reaching for `fetch()` directly with a
 * hand-attached `Authorization` header, which is the exact drift `apiClient`'s
 * header documents as load-bearing: those calls carried no emulation token and
 * no locale header, so a superadmin emulating a customer read their OWN plan on
 * the one screen where reading the wrong plan matters most.
 *
 * `/billing/*` needs the same three calls, so they moved here rather than being
 * copied — and `/pricing` now reads through this too.
 */

export type BillingPlan = 'free' | 'pro' | 'teams';

export interface BillingSubscription {
  plan: BillingPlan;
  effectivePlan: BillingPlan;
  billingStatus: string;
  billingCycle: 'monthly' | 'yearly' | null;
  billingEmail: string | null;
  billingPaymentBrand: string | null;
  billingPaymentLast4: string | null;
  billingUpdatedAt: string | null;
  seatCount: number | null;
  pricing: {
    pro: { monthly: number; yearly: number; yearlySavingsPercent: number };
    teams: { perSeatMonthly: number; perSeatYearly: number; yearlySavingsPercent: number; minimumSeats: number };
    managedAgentHost: { perAgentHostMonthly: number };
  };
}

export type ManagedAgentHostStatus = 'active' | 'past_due' | 'cancelled';

export interface ManagedAgentHostSubscription {
  status: ManagedAgentHostStatus;
  quantity: number;
  externalSubscriptionId: string | null;
  orderId: number | null;
}

export interface ManagedAgentHostRequest {
  id: number;
  agentHostName: string;
  region: string | null;
  notes: string | null;
  status: 'pending' | 'provisioning' | 'active' | 'cancelled' | 'failed';
  agentHostId: number | null;
  provisionedAt: string | null;
  createdAt: string;
}

export const billingApi = {
  subscription: (tenantId: number) =>
    apiRequest<BillingSubscription>(`/api/tenants/${tenantId}/subscription`),
  /** Drop to Free. The processor cancels at period end; the row flips now. */
  downgradeToFree: (tenantId: number) =>
    apiRequest<unknown>(`/api/tenants/${tenantId}/subscription/free`, { method: 'POST' }),
  managedAgentHost: (tenantId: number) =>
    apiRequest<{ subscription: ManagedAgentHostSubscription | null }>(
      `/api/tenants/${tenantId}/add-ons/managed-agent-host`,
    ),
  checkoutManagedAgentHost: (tenantId: number, body: { billingEmail: string; quantity: number }) =>
    apiRequest<{ checkoutUrl?: string; sessionId?: string }>(
      `/api/tenants/${tenantId}/add-ons/managed-agent-host/checkout`,
      { method: 'POST', body: JSON.stringify(body), expectedErrors: [403, 409] },
    ),
  listManagedAgentHostRequests: () =>
    apiRequest<{ requests: ManagedAgentHostRequest[] }>('/api/managed-agent-hosts'),
  requestManagedAgentHost: (body: { agentHostName: string; region?: string; notes?: string }) =>
    apiRequest<{ request: ManagedAgentHostRequest; message?: string }>(
      '/api/managed-agent-hosts',
      { method: 'POST', body: JSON.stringify(body), expectedErrors: [403, 409] },
    ),
  cancelManagedAgentHostRequest: (id: number) =>
    apiRequest<unknown>(`/api/managed-agent-hosts/${id}`, {
      method: 'DELETE',
      expectedErrors: [409],
    }),
};
