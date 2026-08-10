import { TenantService } from '../tenant/TenantService';

export interface SalesRuleLike { ruleKey: string; plan: string; billingCycle: string; referralBps: number; salesBps: number }

export function salesDealRevenueCents(plan: string, billingCycle: string, seats?: number): number {
  const yearly = billingCycle === 'yearly';
  if (plan === 'teams') {
    const count = Math.max(TenantService.PRICING.teams.minimumSeats, seats ?? TenantService.PRICING.teams.minimumSeats);
    return (yearly ? TenantService.PRICING.teams.perSeatYearly : TenantService.PRICING.teams.perSeatMonthly) * count * 100;
  }
  return (yearly ? TenantService.PRICING.pro.yearly : TenantService.PRICING.pro.monthly) * 100;
}

export function commissionPercentToBps(value: unknown): number | null {
  const percent = Number(value);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? Math.round(percent * 100) : null;
}

export function commissionCents(revenueCents: number, basisPoints: number): number {
  return Math.round(revenueCents * basisPoints / 10_000);
}

export function salesRevenueForecast(goalCents: number, rules: SalesRuleLike[]) {
  return rules.map((rule) => {
    const dealRevenueCents = salesDealRevenueCents(rule.plan, rule.billingCycle);
    return { ruleKey: rule.ruleKey, plan: rule.plan, billingCycle: rule.billingCycle, dealRevenueCents, conversionsRequired: goalCents > 0 ? Math.ceil(goalCents / dealRevenueCents) : 0, referralPercent: rule.referralBps / 100, salesPercent: rule.salesBps / 100, referralCommissionPerConversionCents: commissionCents(dealRevenueCents, rule.referralBps), salesCommissionPerConversionCents: commissionCents(dealRevenueCents, rule.salesBps) };
  });
}
