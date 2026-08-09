/**
 * BurnRateOS product taxonomy after consolidation into Builderforce.
 *
 * This file deliberately contains routing and identity only. All visible copy
 * lives in `burnrateMarketing` in the locale catalogs, so the public header,
 * authenticated rail, feature index, and domain pages cannot drift.
 */

export type BurnrateDomainKind = 'domain' | 'foundation';

export interface BurnrateDomain {
  id: string;
  kind: BurnrateDomainKind;
  persona: 'CPO' | 'CFO' | 'CTO' | 'CRO' | 'CEO' | 'CHRO' | 'CISO' | 'CMO' | 'ALL';
  icon: string;
  marketingHref: string;
  /** Existing Builderforce destination used by the signed-in call to action. */
  workspaceHref: string;
}

export const BURNRATE_DOMAINS: readonly BurnrateDomain[] = [
  { id: 'productManagement', kind: 'domain', persona: 'CPO', icon: '📦', marketingHref: '/product-management', workspaceHref: '/projects?tab=pm' },
  { id: 'businessIntelligence', kind: 'domain', persona: 'CFO', icon: '📊', marketingHref: '/business-intelligence', workspaceHref: '/insights/finance' },
  { id: 'agileSurvival', kind: 'domain', persona: 'CTO', icon: '⚡', marketingHref: '/survival-focused-agile', workspaceHref: '/projects?tab=ceremonies' },
  { id: 'salesRevenue', kind: 'domain', persona: 'CRO', icon: '📈', marketingHref: '/sales-revenue', workspaceHref: '/growth' },
  { id: 'customerEngagement', kind: 'domain', persona: 'CRO', icon: '💬', marketingHref: '/customer-engagement', workspaceHref: '/quality?tab=feedback' },
  { id: 'investorIntelligence', kind: 'domain', persona: 'CEO', icon: '💼', marketingHref: '/investor-intelligence', workspaceHref: '/insights' },
  { id: 'operationalCadence', kind: 'domain', persona: 'CHRO', icon: '🎯', marketingHref: '/operational-cadence', workspaceHref: '/workforce' },
  { id: 'governanceSecurity', kind: 'domain', persona: 'CISO', icon: '🛡', marketingHref: '/governance-security', workspaceHref: '/insights/compliance' },
  { id: 'marketingGrowth', kind: 'domain', persona: 'CMO', icon: '📣', marketingHref: '/marketing-growth', workspaceHref: '/growth' },
  { id: 'aiCoach', kind: 'foundation', persona: 'ALL', icon: '✨', marketingHref: '/features/ai-coach', workspaceHref: '/create' },
  { id: 'integrations', kind: 'foundation', persona: 'CTO', icon: '🔌', marketingHref: '/integrations', workspaceHref: '/settings/integrations' },
  { id: 'companiesContacts', kind: 'foundation', persona: 'ALL', icon: '🏢', marketingHref: '/companies-contacts', workspaceHref: '/tenants' },
] as const;

export const BURNRATE_PRODUCT_DOMAINS = BURNRATE_DOMAINS.filter((entry) => entry.kind === 'domain');
export const BURNRATE_FOUNDATIONS = BURNRATE_DOMAINS.filter((entry) => entry.kind === 'foundation');

export function burnrateDomainByHref(href: string): BurnrateDomain | undefined {
  return BURNRATE_DOMAINS.find((entry) => entry.marketingHref === href);
}

export function burnrateDomainBySlug(slug: string): BurnrateDomain | undefined {
  return BURNRATE_DOMAINS.find((entry) => entry.marketingHref === `/${slug}`);
}
