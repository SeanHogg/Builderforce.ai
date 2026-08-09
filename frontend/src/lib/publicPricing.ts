import { apiRequest } from './apiClient';

export type PricingPlanId = 'free' | 'pro' | 'teams';
export interface PublicPricingPlan {
  id: PricingPlanId;
  name: string;
  description: string;
  monthly: number;
  yearly: number;
  priceSuffix: string;
  minimumSeats: number;
  features: string[];
  excluded: string[];
  ctaLabel: string;
  ctaHref: string;
  highlighted: boolean;
}
export interface PublicPricingContract {
  currency: string;
  publishedAt: string;
  plans: PublicPricingPlan[];
  managedAgentHostMonthly: number;
  pricing: {
    currency: string;
    pro: { monthly: number; yearly: number; yearlySavingsPercent: number };
    teams: { perSeatMonthly: number; perSeatYearly: number; yearlySavingsPercent: number; minimumSeats: number };
    managedAgentHost: { perAgentHostMonthly: number };
  };
}

let request: Promise<PublicPricingContract> | null = null;

/** One in-browser request shared by every pricing surface. HTTP caching handles
 * subsequent page loads; the API's publish boundary invalidates its KV snapshot. */
export function fetchPublicPricing(): Promise<PublicPricingContract> {
  if (!request) {
    request = apiRequest<PublicPricingContract>('/api/tenants/pricing', { auth: 'none' })
      .catch((error) => { request = null; throw error; });
  }
  return request;
}

/** Called by the superadmin publish success path; draft saves must not call it. */
export function invalidatePublicPricingRequest(): void {
  request = null;
}
