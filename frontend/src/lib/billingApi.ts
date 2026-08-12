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

export const billingApi = {
  subscription: (tenantId: number) =>
    apiRequest<BillingSubscription>(`/api/tenants/${tenantId}/subscription`),
  /** Drop to Free. The processor cancels at period end; the row flips now. */
  downgradeToFree: (tenantId: number) =>
    apiRequest<unknown>(`/api/tenants/${tenantId}/subscription/free`, { method: 'POST' }),
};
