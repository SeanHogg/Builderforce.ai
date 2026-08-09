import { eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { platformPricingConfiguration } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';

export type PricingPlanCode = 'free' | 'pro' | 'teams';
export interface PricingPlanContent {
  id: PricingPlanCode;
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
export interface PricingDocument {
  currency: string;
  plans: PricingPlanContent[];
  managedAgentHostMonthly: number;
  businessPhone: {
    activation: number;
    monthly: number;
    includedMinutes: number;
    includedSms: number;
    includedMms: number;
    overagePerMinute: number;
    overagePerSms: number;
    overagePerMms: number;
    eligiblePlans: Array<'pro' | 'teams'>;
  };
}
export interface PublishedPricingContract extends PricingDocument {
  publishedAt: string;
  pricing: {
    currency: string;
    pro: { monthly: number; yearly: number; yearlySavingsPercent: number };
    teams: { perSeatMonthly: number; perSeatYearly: number; yearlySavingsPercent: number; minimumSeats: number };
    managedAgentHost: { perAgentHostMonthly: number };
  };
}

const CONFIG_KEY = 'public';
export const PUBLIC_PRICING_CACHE_KEY = 'platform-pricing:published:v1';

export const DEFAULT_PRICING_DOCUMENT: PricingDocument = {
  currency: 'USD',
  managedAgentHostMonthly: 49,
  businessPhone: {
    activation: 19.95,
    monthly: 9.95,
    includedMinutes: 200,
    includedSms: 300,
    includedMms: 15,
    overagePerMinute: 0.05,
    overagePerSms: 0.012,
    overagePerMms: 0.10,
    eligiblePlans: ['pro', 'teams'],
  },
  plans: [
    { id: 'free', name: 'Free', description: 'Start creating free, then upgrade any time.', monthly: 0, yearly: 0, priceSuffix: '/month forever', minimumSeats: 1, features: ['1 AgentHost', '5 projects', '10K tokens / day'], excluded: ['Approval workflows', 'Fleet mesh + remote dispatch', 'Full telemetry + audit trail', 'Custom agent roles'], ctaLabel: 'Create free account', ctaHref: '/register', highlighted: false },
    { id: 'pro', name: 'Pro', description: 'For sustained creative delivery with more capacity and control.', monthly: 29, yearly: 290, priceSuffix: '/month', minimumSeats: 1, features: ['Up to 3 AgentHosts', 'Unlimited projects', '1M tokens / day', 'Approval workflows', 'Fleet mesh + remote dispatch', 'Full telemetry + audit trail', 'Custom agent roles', 'Priority support'], excluded: ['Shared team approval inbox', 'Per-seat cost controls'], ctaLabel: 'Get Pro', ctaHref: '/pricing?upgrade=pro', highlighted: true },
    { id: 'teams', name: 'Teams', description: 'Shared controls and volume pricing for organizations.', monthly: 20, yearly: 192, priceSuffix: '/seat/month', minimumSeats: 5, features: ['Everything in Pro', 'Unlimited AgentHosts', 'Unlimited projects', '5M tokens / day', 'Shared team approval inbox', 'Per-seat cost controls'], excluded: [], ctaLabel: 'Get Teams', ctaHref: '/pricing?upgrade=teams', highlighted: false },
  ],
};

function savings(monthly: number, yearly: number): number {
  return monthly > 0 ? Math.round((1 - yearly / (monthly * 12)) * 100) : 0;
}

function validatePlan(raw: unknown, id: PricingPlanCode): PricingPlanContent {
  const value = raw as Partial<PricingPlanContent>;
  if (value?.id !== id || !value.name?.trim() || !value.description?.trim()) throw new Error(`Invalid ${id} plan content`);
  const monthly = Number(value.monthly);
  const yearly = Number(value.yearly);
  const minimumSeats = Number(value.minimumSeats);
  if (![monthly, yearly, minimumSeats].every(Number.isFinite) || monthly < 0 || yearly < 0 || minimumSeats < 1) throw new Error(`Invalid ${id} plan pricing`);
  if (!Array.isArray(value.features) || !value.features.every((x) => typeof x === 'string' && x.trim())) throw new Error(`Invalid ${id} plan features`);
  if (!Array.isArray(value.excluded) || !value.excluded.every((x) => typeof x === 'string' && x.trim())) throw new Error(`Invalid ${id} excluded features`);
  if (!value.ctaLabel?.trim() || !value.ctaHref?.startsWith('/')) throw new Error(`Invalid ${id} call to action`);
  return { ...value, id, monthly, yearly, minimumSeats, name: value.name.trim(), description: value.description.trim(), priceSuffix: value.priceSuffix?.trim() ?? '', features: value.features.map((x) => x.trim()), excluded: value.excluded.map((x) => x.trim()), ctaLabel: value.ctaLabel.trim(), ctaHref: value.ctaHref, highlighted: value.highlighted === true };
}

export function validatePricingDocument(raw: unknown): PricingDocument {
  const value = raw as Partial<PricingDocument>;
  if (!value || !Array.isArray(value.plans)) throw new Error('Pricing plans are required');
  const byId = new Map(value.plans.map((plan) => [(plan as PricingPlanContent).id, plan]));
  const managed = Number(value.managedAgentHostMonthly);
  if (!value.currency?.trim() || !Number.isFinite(managed) || managed < 0) throw new Error('Invalid pricing metadata');
  const phone = value.businessPhone ?? DEFAULT_PRICING_DOCUMENT.businessPhone;
  const phoneNumbers = [phone.activation, phone.monthly, phone.includedMinutes, phone.includedSms, phone.includedMms, phone.overagePerMinute, phone.overagePerSms, phone.overagePerMms].map(Number);
  if (phoneNumbers.some((number) => !Number.isFinite(number) || number < 0)) throw new Error('Invalid business phone pricing');
  return {
    currency: value.currency.trim().toUpperCase(),
    managedAgentHostMonthly: managed,
    businessPhone: {
      activation: phoneNumbers[0], monthly: phoneNumbers[1], includedMinutes: phoneNumbers[2], includedSms: phoneNumbers[3], includedMms: phoneNumbers[4],
      overagePerMinute: phoneNumbers[5], overagePerSms: phoneNumbers[6], overagePerMms: phoneNumbers[7], eligiblePlans: ['pro', 'teams'],
    },
    plans: (['free', 'pro', 'teams'] as const).map((id) => validatePlan(byId.get(id), id)),
  };
}

function publicContract(document: PricingDocument, publishedAt: Date | string): PublishedPricingContract {
  const pro = document.plans.find((p) => p.id === 'pro')!;
  const teams = document.plans.find((p) => p.id === 'teams')!;
  return { ...document, publishedAt: new Date(publishedAt).toISOString(), pricing: { currency: document.currency, pro: { monthly: pro.monthly, yearly: pro.yearly, yearlySavingsPercent: savings(pro.monthly, pro.yearly) }, teams: { perSeatMonthly: teams.monthly, perSeatYearly: teams.yearly, yearlySavingsPercent: savings(teams.monthly, teams.yearly), minimumSeats: teams.minimumSeats }, managedAgentHost: { perAgentHostMonthly: document.managedAgentHostMonthly } } };
}

async function configuration(db: Db) {
  const [row] = await db.select().from(platformPricingConfiguration).where(eq(platformPricingConfiguration.key, CONFIG_KEY)).limit(1);
  return row ?? null;
}

export async function getPublishedPricing(db: Db, env: Env): Promise<PublishedPricingContract> {
  return getOrSetCached(env, PUBLIC_PRICING_CACHE_KEY, async () => {
    const row = await configuration(db);
    return publicContract(row ? validatePricingDocument(row.publishedDocument) : DEFAULT_PRICING_DOCUMENT, row?.publishedAt ?? new Date(0));
  }, { kvTtlSeconds: 31_536_000, l1TtlMs: 300_000 });
}

export async function getPricingDraft(db: Db) {
  const row = await configuration(db);
  return { draft: row ? validatePricingDocument(row.draftDocument) : DEFAULT_PRICING_DOCUMENT, published: row ? publicContract(validatePricingDocument(row.publishedDocument), row.publishedAt) : publicContract(DEFAULT_PRICING_DOCUMENT, new Date(0)) };
}

export async function savePricingDraft(db: Db, document: unknown): Promise<PricingDocument> {
  const draft = validatePricingDocument(document);
  await db.insert(platformPricingConfiguration).values({ key: CONFIG_KEY, draftDocument: draft, publishedDocument: DEFAULT_PRICING_DOCUMENT }).onConflictDoUpdate({ target: platformPricingConfiguration.key, set: { draftDocument: draft, updatedAt: sql`now()` } });
  return draft;
}

export async function publishPricing(db: Db, env: Env, actorUserId: string): Promise<PublishedPricingContract> {
  const row = await configuration(db);
  const document = row ? validatePricingDocument(row.draftDocument) : DEFAULT_PRICING_DOCUMENT;
  const now = new Date();
  await db.insert(platformPricingConfiguration).values({ key: CONFIG_KEY, draftDocument: document, publishedDocument: document, publishedAt: now, publishedBy: actorUserId }).onConflictDoUpdate({ target: platformPricingConfiguration.key, set: { publishedDocument: document, publishedAt: now, publishedBy: actorUserId, updatedAt: sql`now()` } });
  await invalidateCached(env, PUBLIC_PRICING_CACHE_KEY);
  return publicContract(document, now);
}
